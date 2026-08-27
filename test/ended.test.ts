import { access } from 'node:fs/promises';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { spoolDirs, type SpoolDirs } from '../src/paths';
import { capEndedSessions, ensureDirs, readSession, readSessions, writeSession } from '../src/spool/persist';
import { reduce } from '../src/store/reduce';
import { isOpen, openSessions } from '../src/store/open';
import { rescanLiveSessions } from '../src/claude/rescan';
import { compareSessions } from '../src/ui/tree';
import { sessionDescription, sessionTooltip } from '../src/ui/labels';
import { statusIconPath } from '../src/ui/status-icon';
import type { LiveSession } from '../src/claude/registry';
import type { Session, SpoolEvent } from '../src/events/types';

const base: Session = {
  id: 's1', cwd: '/Users/dev/projet', project: 'projet', origin: 'vscode',
  status: 'running', toolCount: 3, lastEventAt: 10, inFlightSince: 9,
  currentAction: { tool: 'Bash' }, pendingPermission: { tool: 'Bash', summary: 'rm' },
};

const ev = (event: SpoolEvent['event'], at = 20): SpoolEvent => ({
  event, at, entrypoint: 'claude-vscode', termProgram: '', sessionId: 's1', cwd: '/Users/dev/projet',
});

describe('reduce — SessionEnd keeps the conversation, ended', () => {
  it('marks the session ended, idle, with nothing in flight — and keeps it', () => {
    const next = reduce(base, ev('SessionEnd'));
    expect(next).toMatchObject({ id: 's1', status: 'idle', endedAt: 20, lastEventAt: 20, toolCount: 3 });
    expect(next).not.toHaveProperty('inFlightSince');
    expect(next).not.toHaveProperty('currentAction');
    expect(next).not.toHaveProperty('pendingPermission');
  });

  it('still creates nothing for a SessionEnd of a session it never saw', () => {
    expect(reduce(undefined, ev('SessionEnd'))).toBeUndefined();
  });

  it('brings an ended session back to life on any hook, and not on an Ack', () => {
    const ended = { ...base, status: 'idle' as const, endedAt: 20 };
    for (const event of ['SessionStart', 'UserPromptSubmit', 'PreToolUse'] as const) {
      expect(reduce(ended, ev(event, 30)), event).not.toHaveProperty('endedAt');
    }
    expect(reduce(ended, ev('Ack', 30))?.endedAt).toBe(20);
  });
});

describe('isOpen / openSessions', () => {
  it('counts as open what has neither ended nor sleeps in a tab', () => {
    expect(isOpen(base)).toBe(true);
    expect(isOpen({ ...base, endedAt: 1 })).toBe(false);
    expect(isOpen({ ...base, dormant: true })).toBe(false);
    const all = new Map<string, Session>([['a', base], ['b', { ...base, id: 'b', endedAt: 1 }]]);
    expect([...openSessions(all).keys()]).toEqual(['a']);
  });
});

describe('capEndedSessions', () => {
  let home: string;
  let dirs: SpoolDirs;

  beforeEach(async () => {
    home = mkdtempSync(join(tmpdir(), 'koh-ended-'));
    dirs = spoolDirs(home);
    await ensureDirs(dirs);
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  const ended = (id: string, endedAt: number): Session => ({ ...base, id, status: 'idle', endedAt });

  it('keeps the most recently ended ones, up to the cap, and never touches an open session', async () => {
    await writeSession(dirs, ended('old', 1));
    await writeSession(dirs, ended('mid', 2));
    await writeSession(dirs, ended('new', 3));
    await writeSession(dirs, { ...base, id: 'open', lastEventAt: 0 });
    expect(await capEndedSessions(dirs, 2)).toEqual(['old']);
    expect([...(await readSessions(dirs)).keys()].sort()).toEqual(['mid', 'new', 'open']);
  });

  it('removes nothing under the cap', async () => {
    await writeSession(dirs, ended('a', 1));
    expect(await capEndedSessions(dirs, 2)).toEqual([]);
  });
});

describe('rescanLiveSessions — an ended session whose process runs', () => {
  let home: string;
  let dirs: SpoolDirs;

  beforeEach(async () => {
    home = mkdtempSync(join(tmpdir(), 'koh-revive-'));
    dirs = spoolDirs(join(home, 'koh'));
    await ensureDirs(dirs);
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  it('is brought back to life — its twin in another editor is still there — and reported', async () => {
    await writeSession(dirs, { ...base, status: 'idle', endedAt: 20, toolCount: 7 });
    const live = new Map<string, LiveSession>([['s1', { pid: 1, sessionId: 's1', cwd: '/Users/dev/projet', entrypoint: 'claude-vscode', startedAt: 5 }]]);
    expect(await rescanLiveSessions(dirs, live, 100, join(home, 'claude'))).toEqual(['s1']);
    const back = await readSession(dirs, 's1');
    expect(back).not.toHaveProperty('endedAt');
    expect(back?.toolCount).toBe(7);
  });
});

describe('compareSessions — open first, then dormant, then ended', () => {
  const open = (id: string, lastEventAt: number): Session => ({ ...base, id, status: 'idle', lastEventAt });

  it('puts every open session before a dormant tab, and every dormant tab before an ended one', () => {
    const rows: Session[] = [
      { ...open('ended-new', 50), endedAt: 900 },
      { ...open('dormant', 0), dormant: true },
      { ...open('ended-old', 60), endedAt: 100 },
      open('open-old', 1),
      { ...open('running', 1), status: 'running' },
    ];
    expect([...rows].sort(compareSessions).map((s) => s.id)).toEqual(['running', 'open-old', 'dormant', 'ended-new', 'ended-old']);
  });
});

describe('labels — an ended conversation', () => {
  const ended: Session = { ...base, status: 'idle', endedAt: 1_700_000_000_000 - 120_000, title: 'Titre' };
  const now = 1_700_000_000_000;

  it('says when it closed, and how to bring it back', () => {
    expect(sessionDescription(ended, now)).toBe('projet · closed 2 min');
    const tooltip = sessionTooltip(ended, now);
    expect(tooltip).toContain('closed 2 min ago');
    expect(tooltip).toContain('Click to reopen');
    expect(tooltip).not.toContain('running');
  });
});

describe('statusIconPath — the muted dot', () => {
  it('has its own pair of files in the package, for ended and dormant rows', async () => {
    const paths = statusIconPath(join(__dirname, '..'), 'ended');
    expect(paths.light).not.toBe(statusIconPath(join(__dirname, '..'), 'idle').light);
    for (const file of [paths.light, paths.dark]) await expect(access(file)).resolves.toBeUndefined();
  });
});
