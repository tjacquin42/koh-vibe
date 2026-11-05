import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { spoolDirs, type SpoolDirs } from '../src/paths';
import { ensureDirs, readSessions, writeSession } from '../src/spool/persist';
import { drain } from '../src/spool/watcher';
import { acknowledgeClickedSession, acknowledgeVisibleSessions } from '../src/focus/acknowledge';
import type { Session } from '../src/events/types';

// No vscode stub needed: these two functions only take spool folders and
// strings (dirs, folders, id/cwd) as input — they are extracted from
// onVisible and focusSession (extension.ts) precisely to stay testable at
// the composition boundary, not only at the level of the pure primitive
// (sessionsToAcknowledge) that they call. A reviewer proved by mutation
// that reintroducing the exact I6 bug directly into extension.ts
// (acknowledging without filtering by claim, and not acknowledging on
// click) compiled and left every test green as long as only the pure
// primitive was covered.

const session = (over: Partial<Session> = {}): Session => ({
  id: 's1',
  cwd: '/Users/dev/projet',
  project: 'projet',
  origin: 'vscode',
  status: 'done_unseen',
  toolCount: 0,
  lastEventAt: 0,
  ...over,
});

let home: string;
let dirs: SpoolDirs;

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), 'koh-ack-'));
  dirs = spoolDirs(home);
  await ensureDirs(dirs);
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe('acknowledgeVisibleSessions (I6, the « visible view » half)', () => {
  it('acknowledges only the unread finished sessions that these folders claim', async () => {
    await writeSession(dirs, session({ id: 'claimed', cwd: '/Users/dev/projet', status: 'done_unseen' }));
    await writeSession(dirs, session({ id: 'foreign', cwd: '/Users/dev/autre-projet', status: 'done_unseen' }));

    await acknowledgeVisibleSessions(dirs, ['/Users/dev/projet']);
    await drain(dirs, 1);

    const sessions = await readSessions(dirs);
    expect(sessions.get('claimed')?.status).toBe('idle'); // acknowledged
    expect(sessions.get('foreign')?.status).toBe('done_unseen'); // not claimed, not touched
  });

  it("does not acknowledge a session that is claimed but not an unread finished one", async () => {
    await writeSession(dirs, session({ id: 'running', cwd: '/Users/dev/projet', status: 'running' }));

    await acknowledgeVisibleSessions(dirs, ['/Users/dev/projet']);
    await drain(dirs, 1);

    expect((await readSessions(dirs)).get('running')?.status).toBe('running');
  });

  it("acknowledges nothing without an open folder", async () => {
    await writeSession(dirs, session({ id: 'a', cwd: '/Users/dev/projet', status: 'done_unseen' }));

    await acknowledgeVisibleSessions(dirs, []);
    await drain(dirs, 1);

    expect((await readSessions(dirs)).get('a')?.status).toBe('done_unseen');
  });
});

describe('acknowledgeClickedSession (I6, the « click » half)', () => {
  it('acknowledges the clicked session unconditionally, even if no window claims it', async () => {
    await writeSession(dirs, session({ id: 's-cross', cwd: '/Users/dev/autre-projet', status: 'done_unseen' }));

    await acknowledgeClickedSession(dirs, { id: 's-cross', cwd: '/Users/dev/autre-projet' });
    await drain(dirs, 1);

    expect((await readSessions(dirs)).get('s-cross')?.status).toBe('idle');
  });

  it("a click on an unknown session (already purged) does not recreate it (I2, order respected)", async () => {
    await acknowledgeClickedSession(dirs, { id: 'fantome', cwd: '/Users/dev/projet' });
    await drain(dirs, 1);

    expect((await readSessions(dirs)).has('fantome')).toBe(false);
  });
});
