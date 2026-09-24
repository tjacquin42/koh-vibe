import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { spoolDirs, type SpoolDirs } from '../src/paths';
import {
  createSession,
  ensureDirs,
  hideSession,
  readSession,
  readSessions,
  removeSession,
  writeSession,
} from '../src/spool/persist';
import { shownSession } from '../src/claude/dormant';
import { reduceAll } from '../src/store/reduce';
import type { Session, SpoolEvent } from '../src/events/types';

let home: string;
let dirs: SpoolDirs;

const session = (id: string): Session => ({
  id, cwd: '/x', project: 'x', origin: 'vscode',
  status: 'running', toolCount: 3, lastEventAt: 42,
});

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), 'koh-'));
  dirs = spoolDirs(home);
  await ensureDirs(dirs);
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe('persist', () => {
  it('writes then reads back a session', async () => {
    await writeSession(dirs, session('a'));
    const back = await readSessions(dirs);
    expect(back.get('a')).toEqual(session('a'));
  });

  // `dormant` marks an overlay: the tab THIS window has restored, recomputed
  // on every render from the editor's memento. Written to disk, it would
  // survive the closing of the tab it describes, and the conversation would
  // stay forever "a restored tab" — impossible to reopen. The rule lives
  // here, at the one door that leads to disk, rather than in every caller.
  it("never writes the dormant flag, which belongs only to the window that computed it", async () => {
    await writeSession(dirs, { ...session('s1'), dormant: true, endedAt: 42 });
    const back = await readSession(dirs, 's1');
    expect(back?.dormant).toBeUndefined();
    // Everything else goes through intact.
    expect(back?.endedAt).toBe(42);
  });

  it("ignores a dormant flag already present on disk, rather than propagating it", async () => {
    // A file written by a version that did not yet strip the flag.
    // Without this, the conversation would stay stuck until a manual repair:
    // the invariant must hold on read too, not just on write, otherwise it
    // heals nothing of what already exists.
    await writeFile(join(dirs.sessions, 's5.json'), JSON.stringify({ ...session('s5'), dormant: true, endedAt: 7 }), 'utf8');
    expect((await readSession(dirs, 's5'))?.dormant).toBeUndefined();
    expect((await readSessions(dirs)).get('s5')?.dormant).toBeUndefined();
    expect((await readSession(dirs, 's5'))?.endedAt).toBe(7);
  });

  it("createSession does not write it any more either — the door has two leaves", async () => {
    await createSession(dirs, { ...session('s2'), dormant: true });
    expect((await readSession(dirs, 's2'))?.dormant).toBeUndefined();
  });

  it("hideSession, which rewrites a session it has read, does not reintroduce it either", async () => {
    await writeSession(dirs, { ...session('s3'), dormant: true });
    await hideSession(dirs, 's3');
    const back = await readSession(dirs, 's3');
    expect(back?.dormant).toBeUndefined();
    expect(back?.hidden).toBe(true);
  });

  // The seam that actually broke: the output of `shownSession` — a finished
  // conversation that the restored tab makes look awake — goes back through
  // writing when it is put to sleep. Each module was correct on its own; it
  // was their junction that was not, and no test crossed it.
  it("a session shown as awake by a restored tab stays reopenable once rewritten", async () => {
    const onDisk: Session = { ...session('s4'), endedAt: 10 };
    const restored: Session = { ...session('s4'), dormant: true, lastEventAt: 0 };
    const shown = shownSession(onDisk, restored);
    expect(shown?.dormant).toBe(true); // the view genuinely needs the flag

    // What the moon does: it marks the conversation ended and writes it back.
    await writeSession(dirs, { ...shown!, endedAt: 99 });

    const back = await readSession(dirs, 's4');
    // Without this, the click would forever take the "restored tab" branch
    // and try to bring to the front a tab that no longer exists.
    expect(back?.dormant).toBeUndefined();
    expect(back?.endedAt).toBe(99);
  });

  it('leaves no temporary file behind', async () => {
    await writeSession(dirs, session('a'));
    expect(readdirSync(dirs.sessions).filter((f) => f.startsWith('.tmp'))).toHaveLength(0);
  });

  it('removes without throwing if the file is already gone', async () => {
    await expect(removeSession(dirs, 'jamais-vu')).resolves.toBeUndefined();
  });

  it('ignores an unreadable session file', async () => {
    const { writeFile } = await import('node:fs/promises');
    await writeFile(join(dirs.sessions, 'casse.json'), '{ pas du json');
    await writeSession(dirs, session('a'));
    const back = await readSessions(dirs);
    expect(back.size).toBe(1);
  });

  it('ignores a partially conforming session file', async () => {
    const { writeFile } = await import('node:fs/promises');
    await writeFile(
      join(dirs.sessions, 'incomplet.json'),
      JSON.stringify({ id: 'b', status: 'idle', lastEventAt: 1 }),
    );
    await writeSession(dirs, session('a'));
    const back = await readSessions(dirs);
    expect(back.size).toBe(1);
    expect(back.get('a')).toEqual(session('a'));
    expect(back.has('b')).toBe(false);
  });

  it('leaves no temporary file even for concurrent writes with no wait between them', async () => {
    // writeSession is exported and reusable: its safety must not depend on
    // the serialization a caller (SpoolWatcher.tick) otherwise imposes on it.
    await Promise.all([
      writeSession(dirs, session('a')),
      writeSession(dirs, session('a')),
      writeSession(dirs, session('a')),
    ]);
    expect(readdirSync(dirs.sessions).filter((f) => f.startsWith('.tmp'))).toHaveLength(0);
    expect((await readSessions(dirs)).get('a')).toEqual(session('a'));
  });

  describe('readSession', () => {
    it('reads a single session by id, without going through the whole directory', async () => {
      await writeSession(dirs, session('a'));
      await writeSession(dirs, session('b'));
      expect(await readSession(dirs, 'a')).toEqual(session('a'));
    });

    it('returns undefined for a session that is absent', async () => {
      expect(await readSession(dirs, 'jamais-vu')).toBeUndefined();
    });

    it('returns undefined for an unreadable file', async () => {
      const { writeFile } = await import('node:fs/promises');
      await writeFile(join(dirs.sessions, 'casse.json'), '{ pas du json');
      expect(await readSession(dirs, 'casse')).toBeUndefined();
    });
  });

  describe('createSession', () => {
    it('writes a session that was absent, and says so', async () => {
      expect(await createSession(dirs, session('a'))).toBe(true);
      expect(await readSession(dirs, 'a')).toEqual(session('a'));
      expect(readdirSync(dirs.sessions).filter((f) => f.startsWith('.tmp'))).toHaveLength(0);
    });

    it('never overwrites a session that exists, however it got there', async () => {
      await writeSession(dirs, { ...session('a'), toolCount: 9 });
      expect(await createSession(dirs, session('a'))).toBe(false);
      expect((await readSession(dirs, 'a'))?.toolCount).toBe(9);
      expect(readdirSync(dirs.sessions).filter((f) => f.startsWith('.tmp'))).toHaveLength(0);
    });
  });

  it('converges: two reading orders give the same state', () => {
    const mk = (event: SpoolEvent['event'], at: number, id: string): SpoolEvent => ({
      event, at, entrypoint: 'cli', termProgram: '', sessionId: id, cwd: '/x',
    });
    const events = [
      mk('SessionStart', 1, 'a'),
      mk('UserPromptSubmit', 2, 'a'),
      mk('PostToolUse', 3, 'a'),
      mk('Stop', 4, 'a'),
    ];
    const forward = reduceAll(events);
    const shuffled = reduceAll([events[2]!, events[0]!, events[3]!, events[1]!]);
    expect(shuffled.get('a')?.status).toBe(forward.get('a')?.status);
    expect(shuffled.get('a')?.toolCount).toBe(forward.get('a')?.toolCount);
  });
});
