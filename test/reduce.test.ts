import { describe, expect, it } from 'vitest';
import { reduce, reduceAll } from '../src/store/reduce';
import type { EventName, SpoolEvent } from '../src/events/types';

let clock = 1000;
function ev(event: EventName, extra: Partial<SpoolEvent> = {}): SpoolEvent {
  clock += 10;
  return {
    event,
    at: clock,
    entrypoint: 'claude-vscode',
    termProgram: 'vscode',
    sessionId: 's1',
    cwd: '/Users/dev/projet',
    ...extra,
  };
}

describe('reduce', () => {
  it('creates the session on SessionStart, idle', () => {
    const s = reduce(undefined, ev('SessionStart', { transcriptPath: '/t.jsonl' }));
    expect(s?.status).toBe('idle');
    expect(s?.project).toBe('projet');
    expect(s?.origin).toBe('vscode');
    expect(s?.transcriptPath).toBe('/t.jsonl');
    expect(s?.startedAt).toBeDefined();
  });

  it('creates the session even with no SessionStart', () => {
    const s = reduce(undefined, ev('PreToolUse', { toolName: 'Bash' }));
    expect(s?.status).toBe('running');
    expect(s?.startedAt).toBeUndefined();
  });

  it('goes to working on the prompt', () => {
    const a = reduce(undefined, ev('SessionStart'));
    expect(reduce(a, ev('UserPromptSubmit'))?.status).toBe('running');
  });

  it('shows the current action and drops it on PostToolUse', () => {
    const a = reduce(undefined, ev('PreToolUse', { toolName: 'Edit', toolTarget: '/x/a.ts' }));
    expect(a?.currentAction).toEqual({ tool: 'Edit', target: '/x/a.ts' });
    expect(a?.inFlightSince).toBeDefined();
    const b = reduce(a, ev('PostToolUse', { toolName: 'Edit' }));
    expect(b?.currentAction).toBeUndefined();
    expect(b?.inFlightSince).toBeUndefined();
    expect(b?.toolCount).toBe(1);
  });

  it('goes to waiting on PermissionRequest, with the detail', () => {
    const a = reduce(undefined, ev('PreToolUse', { toolName: 'Bash' }));
    const b = reduce(a, ev('PermissionRequest', { toolName: 'Bash', toolTarget: 'rm -rf dist' }));
    expect(b?.status).toBe('waiting');
    expect(b?.pendingPermission).toEqual({ tool: 'Bash', summary: 'rm -rf dist' });
  });

  it('goes to waiting on Notification', () => {
    const a = reduce(undefined, ev('UserPromptSubmit'));
    expect(reduce(a, ev('Notification', { message: 'attend ton accord' }))?.status).toBe('waiting');
  });

  it('leaves waiting when a tool starts again', () => {
    const a = reduce(undefined, ev('PermissionRequest', { toolName: 'Bash' }));
    const b = reduce(a, ev('PreToolUse', { toolName: 'Bash' }));
    expect(b?.status).toBe('running');
    expect(b?.pendingPermission).toBeUndefined();
  });

  it('finishes unread, then idle once acknowledged', () => {
    const a = reduce(undefined, ev('UserPromptSubmit'));
    const b = reduce(a, ev('Stop'));
    expect(b?.status).toBe('done_unseen');
    expect(reduce(b, ev('Ack'))?.status).toBe('idle');
  });

  it('an Ack on a working session changes nothing', () => {
    const a = reduce(undefined, ev('PreToolUse', { toolName: 'Bash' }));
    expect(reduce(a, ev('Ack'))?.status).toBe('running');
  });

  it('SessionEnd keeps the session, marked ended and idle', () => {
    const a = reduce(undefined, ev('SessionStart'));
    const b = reduce(a, ev('SessionEnd'));
    expect(b?.endedAt).toBe(b?.lastEventAt);
    expect(b?.status).toBe('idle');
  });

  it('a late hook does not revive an ended conversation, but keeps its cumulative effects', () => {
    const a = reduce(undefined, ev('SessionStart'));
    const ended = reduce(a, ev('SessionEnd'));
    const stale = reduce(ended, ev('PostToolUse', { at: (ended?.lastEventAt ?? 0) - 5 }));
    expect(stale?.endedAt).toBe(ended?.endedAt);
    expect(stale?.toolCount).toBe(1);
  });

  it('a late SessionEnd does not end a conversation that has spoken since (a twin in another editor)', () => {
    const a = reduce(undefined, ev('SessionStart'));
    const b = reduce(a, ev('UserPromptSubmit'));
    const c = reduce(b, ev('SessionEnd', { at: (b?.lastEventAt ?? 0) - 5 }));
    expect(c).not.toHaveProperty('endedAt');
    expect(c?.status).toBe('running');
  });

  it('an Ack on a session that is not there creates nothing: only a hook event brings a session into being', () => {
    expect(reduce(undefined, ev('Ack'))).toBeUndefined();
  });

  it('a late event does not make the status regress', () => {
    const a = reduce(undefined, ev('Stop'));
    const late: SpoolEvent = { ...ev('UserPromptSubmit'), at: 1 };
    expect(reduce(a, late)?.status).toBe('done_unseen');
  });

  it('but its cumulative effects count', () => {
    const a = reduce(undefined, ev('Stop'));
    const late: SpoolEvent = { ...ev('PostToolUse'), at: 1 };
    expect(reduce(a, late)?.toolCount).toBe(1);
    expect(reduce(a, late)?.lastEventAt).toBe(a?.lastEventAt);
  });

  it('holds several sessions and a worktree', () => {
    const map = reduceAll([
      ev('SessionStart', { sessionId: 'a' }),
      ev('PreToolUse', { sessionId: 'b', cwd: '/Users/dev/projet/.worktrees/feat-seo' }),
      ev('Stop', { sessionId: 'a' }),
    ]);
    expect(map.size).toBe(2);
    expect(map.get('a')?.status).toBe('done_unseen');
    expect(map.get('b')?.branch).toBe('feat-seo');
    expect(map.get('b')?.project).toBe('projet');
  });
});
