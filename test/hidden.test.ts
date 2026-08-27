import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { spoolDirs, type SpoolDirs } from '../src/paths';
import { ensureDirs, hideSession, readSession, writeSession } from '../src/spool/persist';
import { reduce } from '../src/store/reduce';
import { visibleSessions } from '../src/store/visible';
import type { Session, SpoolEvent } from '../src/events/types';

const base: Session = {
  id: 's1', cwd: '/Users/dev/projet', project: 'projet', origin: 'vscode',
  status: 'idle', toolCount: 3, lastEventAt: 10,
};

const ev = (event: SpoolEvent['event'], at = 20): SpoolEvent => ({
  event, at, entrypoint: 'claude-vscode', termProgram: '', sessionId: 's1', cwd: '/Users/dev/projet',
});

describe('reduce — a hidden session', () => {
  it('comes back on the next hook: activity is what the user removed it for lack of', () => {
    for (const event of ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop', 'Notification', 'PermissionRequest'] as const) {
      const next = reduce({ ...base, hidden: true }, ev(event));
      expect(next, event).not.toHaveProperty('hidden');
    }
  });

  it('stays hidden on an Ack, which is ours and not the conversation\'s', () => {
    expect(reduce({ ...base, status: 'done_unseen', hidden: true }, ev('Ack'))?.hidden).toBe(true);
  });

  it('ends on SessionEnd, and is hidden no more: the row is back, greyed', () => {
    const s = reduce({ ...base, hidden: true }, ev('SessionEnd'));
    expect(s?.endedAt).toBe(20);
    expect(s).not.toHaveProperty('hidden');
  });
});

describe('hideSession', () => {
  let home: string;
  let dirs: SpoolDirs;

  beforeEach(async () => {
    home = mkdtempSync(join(tmpdir(), 'koh-hidden-'));
    dirs = spoolDirs(home);
    await ensureDirs(dirs);
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  it('marks the session hidden and keeps everything else', async () => {
    await writeSession(dirs, { ...base, status: 'running', inFlightSince: 9 });
    expect(await hideSession(dirs, 's1')).toBe(true);
    expect(await readSession(dirs, 's1')).toEqual({ ...base, status: 'running', inFlightSince: 9, hidden: true });
  });

  it('does nothing, and says so, for a session that is not there', async () => {
    expect(await hideSession(dirs, 'absent')).toBe(false);
    expect(await readSession(dirs, 'absent')).toBeUndefined();
  });
});

describe('visibleSessions', () => {
  it('leaves the hidden ones out, and the map it was given untouched', () => {
    const all = new Map<string, Session>([
      ['s1', base],
      ['s2', { ...base, id: 's2', hidden: true }],
    ]);
    const visible = visibleSessions(all);
    expect([...visible.keys()]).toEqual(['s1']);
    expect(all.size).toBe(2);
  });
});
