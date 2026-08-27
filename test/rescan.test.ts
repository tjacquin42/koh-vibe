import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { spoolDirs, type SpoolDirs } from '../src/paths';
import { ensureDirs, readSession, readSessions, writeSession } from '../src/spool/persist';
import type { LiveSession } from '../src/claude/registry';
import { rescanLiveSessions, transcriptPathFor } from '../src/claude/rescan';

let home: string;
let claude: string;
let dirs: SpoolDirs;

const NOW = 5_000_000;

const live = (sessionId: string, extra: Partial<LiveSession> = {}): LiveSession => ({
  pid: 4242,
  sessionId,
  cwd: '/Users/dev/projet',
  entrypoint: 'claude-vscode',
  startedAt: 4_000_000,
  ...extra,
});

const registry = (...entries: LiveSession[]): Map<string, LiveSession> =>
  new Map(entries.map((e) => [e.sessionId, e]));

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), 'koh-rescan-'));
  claude = join(home, 'claude');
  dirs = spoolDirs(join(home, 'koh'));
  await ensureDirs(dirs);
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe('transcriptPathFor', () => {
  it('slugs the working directory the way Claude Code names its project folders', () => {
    // Observed: every character outside [A-Za-z0-9] becomes a dash, dots and
    // underscores included — `/a/.b_c` is `-a--b-c`, never `-a-.b_c`.
    expect(transcriptPathFor('/Users/dev/.claude', '/Users/dev/projet/.worktrees/feat_x', 'abc')).toBe(
      '/Users/dev/.claude/projects/-Users-dev-projet--worktrees-feat-x/abc.jsonl',
    );
  });
});

describe('rescanLiveSessions', () => {
  it('adds a live conversation the spool does not know, with what the registry and the path say', async () => {
    const entry = live('s1', { cwd: '/Users/dev/projet/.worktrees/feat-seo' });

    const added = await rescanLiveSessions(dirs, registry(entry), NOW, claude);

    expect(added).toEqual(['s1']);
    expect(await readSession(dirs, 's1')).toEqual({
      id: 's1',
      cwd: '/Users/dev/projet/.worktrees/feat-seo',
      project: 'projet',
      branch: 'feat-seo',
      origin: 'vscode',
      status: 'idle',
      toolCount: 0,
      lastEventAt: 4_000_000,
      startedAt: 4_000_000,
    });
  });

  it('points at the transcript only when the file really exists', async () => {
    const path = transcriptPathFor(claude, '/Users/dev/projet', 's1');
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, '', 'utf8');

    await rescanLiveSessions(dirs, registry(live('s1'), live('s2')), NOW, claude);

    expect((await readSession(dirs, 's1'))?.transcriptPath).toBe(path);
    expect(await readSession(dirs, 's2')).not.toHaveProperty('transcriptPath');
  });

  it('leaves a conversation the spool already knows exactly as it is', async () => {
    await writeSession(dirs, {
      id: 's1', cwd: '/Users/dev/projet', project: 'projet', origin: 'vscode',
      status: 'running', toolCount: 7, lastEventAt: 4_900_000, inFlightSince: 4_900_000,
    });

    const added = await rescanLiveSessions(dirs, registry(live('s1')), NOW, claude);

    expect(added).toEqual([]);
    const back = await readSession(dirs, 's1');
    expect(back?.status).toBe('running');
    expect(back?.toolCount).toBe(7);
    expect(back?.inFlightSince).toBe(4_900_000);
  });

  it('adds nothing and removes nothing when the registry is empty', async () => {
    await writeSession(dirs, {
      id: 'kept', cwd: '/Users/dev/projet', project: 'projet', origin: 'terminal',
      status: 'idle', toolCount: 0, lastEventAt: 1,
    });
    expect(await rescanLiveSessions(dirs, new Map(), NOW, claude)).toEqual([]);
    expect((await readSessions(dirs)).size).toBe(1);
  });

  it('dates a session from its process start, and from now when the registry has no start', async () => {
    const { startedAt: _dropped, ...noStart } = live('no-start');
    await rescanLiveSessions(dirs, registry(live('dated'), noStart), NOW, claude);
    expect((await readSession(dirs, 'dated'))?.lastEventAt).toBe(4_000_000);
    expect((await readSession(dirs, 'no-start'))?.lastEventAt).toBe(NOW);
    expect(await readSession(dirs, 'no-start')).not.toHaveProperty('startedAt');
  });

  it('reads the origin off the entrypoint, like the hooks do', async () => {
    await rescanLiveSessions(
      dirs,
      registry(live('term', { entrypoint: 'cli' }), live('desk', { entrypoint: 'claude-desktop' }), live('none', { entrypoint: '' })),
      NOW,
      claude,
    );
    expect((await readSession(dirs, 'term'))?.origin).toBe('terminal');
    expect((await readSession(dirs, 'desk'))?.origin).toBe('desktop');
    expect((await readSession(dirs, 'none'))?.origin).toBe('unknown');
  });

  it('reports the ids it added, in a stable order', async () => {
    const added = await rescanLiveSessions(dirs, registry(live('b'), live('a'), live('c')), NOW, claude);
    expect(added).toEqual(['a', 'b', 'c']);
  });
});
