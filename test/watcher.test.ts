import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { spoolDirs, type SpoolDirs } from '../src/paths';
import { ensureDirs, readSessions, writeSession } from '../src/spool/persist';
import { appendLocalEvent, drain, MAX_EVENT_AGE_MS, SpoolWatcher } from '../src/spool/watcher';
import type { Session } from '../src/events/types';

// `node:fs/promises` is a native module: its exports cannot be redefined via
// vi.spyOn. We mock it entirely, delegating to the real implementation
// except when a test arms one of the overrides. An override that returns
// `undefined` lets the call through to the real implementation (same
// convention for all three): this is what lets a test fake only one precise
// path (e.g. a single session id) without having to reimplement the rest.
const { unlinkOverride, writeFileOverride, readFileOverride } = vi.hoisted(() => ({
  unlinkOverride: { current: undefined as ((path: string) => Promise<void>) | undefined },
  writeFileOverride: {
    current: undefined as ((path: string, data: string) => Promise<void> | undefined) | undefined,
  },
  readFileOverride: { current: undefined as ((path: string) => Promise<string> | undefined) | undefined },
}));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    unlink: (path: Parameters<typeof actual.unlink>[0]) =>
      unlinkOverride.current !== undefined ? unlinkOverride.current(String(path)) : actual.unlink(path),
    writeFile: (
      path: Parameters<typeof actual.writeFile>[0],
      data: Parameters<typeof actual.writeFile>[1],
      options?: Parameters<typeof actual.writeFile>[2],
    ) => {
      const override = writeFileOverride.current?.(String(path), String(data));
      return override !== undefined ? override : actual.writeFile(path, data, options);
    },
    readFile: (
      path: Parameters<typeof actual.readFile>[0],
      encoding?: Parameters<typeof actual.readFile>[1],
    ) => {
      const override = readFileOverride.current?.(String(path));
      return override !== undefined ? override : actual.readFile(path, encoding);
    },
  };
});

let home: string;
let dirs: SpoolDirs;

// Test clock, unrelated to Date.now(): the `at` of events stays small,
// readable integers (1, 2, 3…). NOW is slightly later than those (the age of
// these events stays under MAX_EVENT_AGE_MS, without which a failure induced
// in these tests would be discarded outright instead of deferred).
const NOW = 1_000;

async function dropEvent(name: string, body: unknown): Promise<void> {
  await writeFile(join(dirs.events, name), JSON.stringify(body), 'utf8');
}

const hook = (event: string, at: number, extra: Record<string, unknown> = {}) => ({
  event, at, entrypoint: 'cli', termProgram: '',
  payload: { session_id: 's1', cwd: '/Users/dev/projet', ...extra },
});

const session = (id: string, lastEventAt: number) => ({
  id, cwd: '/x', project: 'x', origin: 'vscode' as const,
  status: 'idle' as const, toolCount: 0, lastEventAt,
});

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), 'koh-'));
  dirs = spoolDirs(home);
  await ensureDirs(dirs);
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
  unlinkOverride.current = undefined;
  writeFileOverride.current = undefined;
  readFileOverride.current = undefined;
});

describe('drain', () => {
  it('applies the events, writes the state, then deletes the file', async () => {
    await dropEvent('1-1-SessionStart.json', hook('SessionStart', 1));
    await dropEvent('2-1-PreToolUse.json', hook('PreToolUse', 2, { tool_name: 'Bash' }));
    const res = await drain(dirs, NOW);
    expect(res.applied).toBe(2);
    expect((await readSessions(dirs)).get('s1')?.status).toBe('running');
    expect(readdirSync(dirs.events).filter((f) => f.endsWith('.json'))).toHaveLength(0);
  });

  it('processes files in the order of their name', async () => {
    await dropEvent('20-1-Stop.json', hook('Stop', 20));
    await dropEvent('10-1-UserPromptSubmit.json', hook('UserPromptSubmit', 10));
    await drain(dirs, NOW);
    expect((await readSessions(dirs)).get('s1')?.status).toBe('done_unseen');
  });

  it('sets aside an unreadable file without blocking the others', async () => {
    await writeFile(join(dirs.events, '1-1-Casse.json'), '{ pas du json', 'utf8');
    await dropEvent('2-1-SessionStart.json', hook('SessionStart', 2));
    const res = await drain(dirs, NOW);
    expect(res.applied).toBe(1);
    expect(res.rejected).toBe(1);
    expect(readdirSync(dirs.rejected)).toHaveLength(1);
  });

  it('keeps the session on SessionEnd, marked ended', async () => {
    await dropEvent('1-1-SessionStart.json', hook('SessionStart', 1));
    await drain(dirs, NOW);
    await dropEvent('2-1-SessionEnd.json', hook('SessionEnd', 2));
    await drain(dirs, NOW);
    const s = (await readSessions(dirs)).get('s1');
    expect(s?.endedAt).toBe(2);
    expect(s?.status).toBe('idle');
  });

  it('ignores the bridge temporary file while it is being written', async () => {
    await writeFile(join(dirs.events, '.tmp-1-Stop'), '{"incomp', 'utf8');
    const res = await drain(dirs, NOW);
    expect(res.applied).toBe(0);
    expect(res.rejected).toBe(0);
  });

  it('appendLocalEvent produces an event that drain can read', async () => {
    await dropEvent('1-1-Stop.json', hook('Stop', 1));
    await drain(dirs, NOW);
    await appendLocalEvent(dirs, { event: 'Ack', sessionId: 's1', cwd: '/Users/dev/projet' });
    await drain(dirs, NOW);
    expect((await readSessions(dirs)).get('s1')?.status).toBe('idle');
  });

  it('concurrent appendLocalEvent calls (with no wait between them) each produce a distinct file', async () => {
    // process.pid stays constant for the whole lifetime of the extension's process:
    // two concurrent calls carrying the same event must not stomp on each other.
    const calls = [
      appendLocalEvent(dirs, { event: 'Ack', sessionId: 's1', cwd: '/Users/dev/projet' }),
      appendLocalEvent(dirs, { event: 'Ack', sessionId: 's2', cwd: '/Users/dev/projet' }),
      appendLocalEvent(dirs, { event: 'Ack', sessionId: 's3', cwd: '/Users/dev/projet' }),
    ];
    await Promise.all(calls);

    const files = readdirSync(dirs.events).filter((f) => f.endsWith('.json'));
    expect(files).toHaveLength(3);

    const sessionIds = new Set<string>();
    for (const name of files) {
      const raw = await readFile(join(dirs.events, name), 'utf8');
      const parsed = JSON.parse(raw) as { payload: { session_id: string } };
      sessionIds.add(parsed.payload.session_id);
    }
    expect(sessionIds).toEqual(new Set(['s1', 's2', 's3']));
  });
});

describe('drain — a silent conversation stays', () => {
  it('removes nothing for silence alone, however long it lasts', async () => {
    // A tab left open for a week is still a conversation. Only `SessionEnd`,
    // or the user closing or removing it, takes a session off the list.
    await writeSession(dirs, session('quiet-for-a-week', 0));
    const res = await drain(dirs, 7 * 24 * 3_600_000);
    expect((await readSessions(dirs)).has('quiet-for-a-week')).toBe(true);
    expect(res).not.toHaveProperty('purged');
  });
});

describe('drain — deletion failures', () => {
  it('silently ignores a failing unlink with ENOENT (already deleted by another window)', async () => {
    await dropEvent('1-1-SessionStart.json', hook('SessionStart', 1));
    const err = Object.assign(new Error('ENOENT: no such file or directory'), { code: 'ENOENT' });
    unlinkOverride.current = () => Promise.reject(err);

    const res = await drain(dirs, NOW);
    unlinkOverride.current = undefined;

    expect(res.applied).toBe(1);
    expect(res.rejected).toBe(0);
    expect(readdirSync(dirs.rejected)).toHaveLength(0);
    expect((await readSessions(dirs)).get('s1')?.startedAt).toBe(1);
  });

  it('sets aside an event whose deletion fails for a real reason, to avoid double-counting', async () => {
    await dropEvent('1-1-PostToolUse.json', hook('PostToolUse', 1, { tool_name: 'Bash' }));
    const err = Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });
    unlinkOverride.current = () => Promise.reject(err);

    const res = await drain(dirs, NOW);
    unlinkOverride.current = undefined;

    expect(res.applied).toBe(1);
    expect(res.rejected).toBe(1);
    expect(readdirSync(dirs.rejected).filter((f) => f.endsWith('.json'))).toHaveLength(1);
    expect(readdirSync(dirs.events).filter((f) => f.endsWith('.json'))).toHaveLength(0);

    // The set-aside file can no longer be reprocessed: a second drain does not
    // double the tool counter, which is cumulative.
    const res2 = await drain(dirs, NOW);
    expect(res2.applied).toBe(0);
    expect((await readSessions(dirs)).get('s1')?.toolCount).toBe(1);
  });
});

describe('drain — write failures (C2)', () => {
  it('a write failure does not make drain() throw: the event is deferred, not lost, not classed invalid', async () => {
    await dropEvent('1-1-SessionStart.json', hook('SessionStart', 1));
    const err = Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });
    writeFileOverride.current = () => Promise.reject(err);

    const res = await drain(dirs, NOW);
    writeFileOverride.current = undefined;

    expect(res.applied).toBe(0);
    expect(res.deferred).toBe(1);
    expect(res.rejected).toBe(0);
    // Neither deleted nor set aside to rejected/: it will be retried on the next drain.
    expect(readdirSync(dirs.events).filter((f) => f.endsWith('.json'))).toHaveLength(1);
    expect(readdirSync(dirs.rejected)).toHaveLength(0);
    expect((await readSessions(dirs)).size).toBe(0);
  });

  it('an event whose write fails does not block the following events of the same drain', async () => {
    await dropEvent('1-1-SessionStart.json', hook('SessionStart', 1, { session_id: 's-panne' }));
    await dropEvent('2-1-SessionStart.json', hook('SessionStart', 1, { session_id: 's-ok' }));
    const err = Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });
    // Only fakes the write of the failing session; lets the other one through.
    writeFileOverride.current = (path) => (path.includes('s-panne') ? Promise.reject(err) : undefined);

    const res = await drain(dirs, NOW);
    writeFileOverride.current = undefined;

    expect(res.applied).toBe(1);
    expect(res.deferred).toBe(1);
    const sessions = await readSessions(dirs);
    expect(sessions.has('s-ok')).toBe(true);
    expect(sessions.has('s-panne')).toBe(false);
    // The file of the failing event stays in place; the one that succeeded is gone.
    const remaining = readdirSync(dirs.events).filter((f) => f.endsWith('.json'));
    expect(remaining).toEqual(['1-1-SessionStart.json']);
  });

  it('a transient failure resolves on its own: the next drain, without the failure, applies the event left aside', async () => {
    await dropEvent('1-1-SessionStart.json', hook('SessionStart', 1));
    const err = Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });
    writeFileOverride.current = () => Promise.reject(err);
    const first = await drain(dirs, NOW);
    expect(first.deferred).toBe(1);

    writeFileOverride.current = undefined;
    const second = await drain(dirs, NOW);

    expect(second.applied).toBe(1);
    expect((await readSessions(dirs)).get('s1')?.startedAt).toBe(1);
  });
});

describe('drain — permanent failure (N3)', () => {
  it("an event already older than MAX_EVENT_AGE_MS that fails is set aside to rejected/ with its reason, on the very first pass", async () => {
    // Realistic timestamp (not a small integer for reading comfort):
    // it, and only it, determines the age — no accumulated state.
    const createdAt = 10_000_000;
    await dropEvent(`${createdAt}-1-SessionStart.json`, hook('SessionStart', 1));
    const err = Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });
    // Only sessions/ is failing (like sessions/ set to 0555 in the review):
    // writing the reason to rejected/ still has to succeed.
    writeFileOverride.current = (path) => (path.includes(dirs.sessions) ? Promise.reject(err) : undefined);

    // A single call — as a window that had never seen this event would make
    // it, opened for the first time after the event went past the age
    // limit: no history of attempts to accumulate.
    const res = await drain(dirs, createdAt + MAX_EVENT_AGE_MS + 1);
    writeFileOverride.current = undefined;

    expect(res.deferred).toBe(0);
    expect(res.rejectedPermanently).toEqual([`${createdAt}-1-SessionStart.json`]);
    expect(res.rejected).toBe(1);
    expect(readdirSync(dirs.events).filter((f) => f.endsWith('.json'))).toHaveLength(0);

    const rejectedFiles = readdirSync(dirs.rejected);
    expect(rejectedFiles).toContain(`${createdAt}-1-SessionStart.json`);
    expect(rejectedFiles).toContain(`${createdAt}-1-SessionStart.json.reason.txt`);
    const reason = await readFile(join(dirs.rejected, `${createdAt}-1-SessionStart.json.reason.txt`), 'utf8');
    expect(reason).toContain('EACCES');

    expect((await readSessions(dirs)).size).toBe(0);
  });

  it("under MAX_EVENT_AGE_MS, the event stays deferred and retries instead of being set aside — same failure, younger", async () => {
    const createdAt = 10_000_000;
    await dropEvent(`${createdAt}-1-SessionStart.json`, hook('SessionStart', 1));
    const err = Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });
    writeFileOverride.current = () => Promise.reject(err);

    // Still well under the threshold.
    const res = await drain(dirs, createdAt + MAX_EVENT_AGE_MS - 1);
    writeFileOverride.current = undefined;

    expect(res.rejectedPermanently).toEqual([]);
    expect(res.deferred).toBe(1);
    expect(readdirSync(dirs.events).filter((f) => f.endsWith('.json'))).toHaveLength(1);
    expect(readdirSync(dirs.rejected).filter((f) => f.endsWith('.json') || f.endsWith('.txt'))).toHaveLength(0);
  });

  it("the decision depends on no in-memory state: two independent calls (two « windows », no shared map) on an event of the same age settle the same way", async () => {
    const createdAt = 10_000_000;
    const err = Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });
    writeFileOverride.current = (path) => (path.includes(dirs.sessions) ? Promise.reject(err) : undefined);

    // « Window A », never opened before: a single call to drain(), with
    // nothing in memory, event already old.
    await dropEvent(`${createdAt}-1-SessionStart.json`, hook('SessionStart', 1, { session_id: 's-a' }));
    const resA = await drain(dirs, createdAt + MAX_EVENT_AGE_MS + 1);
    expect(resA.rejectedPermanently).toEqual([`${createdAt}-1-SessionStart.json`]);

    // « Window B », just as fresh, on a second event of the same relative age
    // (same gap between its timestamp and `now`): same verdict, on the
    // first try, without ever having accumulated anything on THIS event.
    await dropEvent(`${createdAt}-2-SessionStart.json`, hook('SessionStart', 1, { session_id: 's-b' }));
    const resB = await drain(dirs, createdAt + MAX_EVENT_AGE_MS + 1);
    writeFileOverride.current = undefined;

    expect(resB.rejectedPermanently).toEqual([`${createdAt}-2-SessionStart.json`]);
  });

  it('SpoolWatcher.tick() signals once via onError when an event is permanently set aside, on the very first tick', async () => {
    const createdAt = 10_000_000;
    await dropEvent(`${createdAt}-1-SessionStart.json`, hook('SessionStart', 1));
    const err = Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });
    writeFileOverride.current = () => Promise.reject(err);

    const onChange = vi.fn();
    const onError = vi.fn();
    const watcher = new SpoolWatcher(dirs, onChange, onError, () => createdAt + MAX_EVENT_AGE_MS + 1, async () => undefined, () => 'keep', async () => true);
    const internal = watcher as unknown as { tick: () => Promise<void> };

    await internal.tick();
    writeFileOverride.current = undefined;

    expect(onError).toHaveBeenCalledTimes(1);
    expect(readdirSync(dirs.rejected)).toContain(`${createdAt}-1-SessionStart.json`);
  });
});

describe('drain — spool directory gone (M9)', () => {
  it("recreates the spool (ensureDirs) when it finds that events/ has disappeared, rather than staying silent until the window reloads", async () => {
    // Simulates `rm -rf ~/.koh-vibe` while the extension is running.
    rmSync(home, { recursive: true, force: true });
    expect(existsSync(dirs.events)).toBe(false);

    const res = await drain(dirs, NOW);

    expect(res.applied).toBe(0);
    expect(res.rejected).toBe(0);
    expect(res.deferred).toBe(0);
    expect(existsSync(dirs.events)).toBe(true);
    expect(existsSync(dirs.sessions)).toBe(true);
    expect(existsSync(dirs.requests)).toBe(true);

    // The recreated spool works normally: an event dropped afterwards
    // (e.g. by the bridge, which no longer sees the `[[ -d "$DIR" ]]` guard fail)
    // is indeed consumed on the next drain.
    await dropEvent('1-1-SessionStart.json', hook('SessionStart', 1));
    const res2 = await drain(dirs, NOW);
    expect(res2.applied).toBe(1);
    expect((await readSessions(dirs)).get('s1')?.startedAt).toBe(1);
  });
});

describe('drain — convergence between windows (I1)', () => {
  it("a window writing from a stale base does not resurrect a session deleted in the meantime by another one (non-persistent sessions)", async () => {
    // Sets s1 up as « done, unseen », as reduce foresees.
    await dropEvent('1-1-SessionStart.json', hook('SessionStart', 1));
    await dropEvent('2-1-Stop.json', hook('Stop', 2));
    await drain(dirs, NOW);
    expect((await readSessions(dirs)).get('s1')?.status).toBe('done_unseen');

    // Window A: an Ack waiting to be processed. Intercepted right after it
    // has read the CONTENT of this file — the same interleaving point a real
    // `await` between two processes would have. Fires only once: window B
    // has to be able to reread this same file without getting stuck on it.
    await dropEvent('3-1-Ack.json', hook('Ack', 3));
    let triggered = false;
    let releaseA: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      releaseA = resolve;
    });
    let reachedGate: () => void = () => undefined;
    const reached = new Promise<void>((resolve) => {
      reachedGate = resolve;
    });
    readFileOverride.current = (path) => {
      if (triggered || !path.endsWith('3-1-Ack.json')) return undefined;
      triggered = true;
      const real = readFile(path, 'utf8');
      reachedGate();
      return gate.then(() => real);
    };

    const drainA = drain(dirs, NOW, undefined, undefined, 'remove');
    await reached;

    // Window B: drops the SessionEnd and drains the whole spool while A is
    // paused. B also sees the Ack file (not yet deleted by A): that does not
    // matter, its reduction is pure and B ends up removing s1.
    await dropEvent('4-1-SessionEnd.json', hook('SessionEnd', 4));
    const resB = await drain(dirs, NOW, undefined, undefined, 'remove');
    expect(resB.applied).toBeGreaterThanOrEqual(1);
    expect((await readSessions(dirs)).size).toBe(0);

    releaseA();
    const resA = await drainA;
    readFileOverride.current = undefined;

    expect(resA.applied).toBe(1);
    // The SessionEnd was applied and its file deleted by B: the session
    // must not come back because A writes from a base read before B.
    expect((await readSessions(dirs)).size).toBe(0);
    expect(readdirSync(dirs.events).filter((f) => f.endsWith('.json'))).toHaveLength(0);
  });
});

describe("drain — late write after abandonment (N2 continued)", () => {
  it("an abandonment signal consulted right before the write keeps an abandoned run from overwriting a more recent state", async () => {
    // s1 starts out idle (startedAt=1, lastEventAt=1, toolCount=0).
    await dropEvent('1-1-SessionStart.json', hook('SessionStart', 1));
    await drain(dirs, NOW);
    expect((await readSessions(dirs)).get('s1')?.status).toBe('idle');

    // « Run O » (the one a guardian will abandon): a PostToolUse.
    // Reduced against the initial idle state (read BEFORE the more recent
    // Stop), it would produce an "idle" state (PostToolUse does not touch
    // status) — the failure targeted here is that this write, if it happens
    // AFTER the Stop, unconditionally overwrites the more recent state it wrote.
    await dropEvent('2-1-PostToolUse.json', hook('PostToolUse', 2, { tool_name: 'Bash' }));

    let triggered = false;
    let releaseO: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      releaseO = resolve;
    });
    let reachedGate: () => void = () => undefined;
    const reached = new Promise<void>((resolve) => {
      reachedGate = resolve;
    });
    // Intercepts the read of the SESSION FILE (not that of the event): this
    // is the real interleaving point between « O has read the state it will
    // reduce from » and « O acts on what it read ». The real read is fired
    // immediately (it captures the state still stale, before the more recent
    // Stop); only the DELIVERY to O is delayed, which is what a real `await`
    // would do between two processes.
    readFileOverride.current = (path) => {
      if (triggered || !path.endsWith('sessions/s1.json')) return undefined;
      triggered = true;
      const real = readFile(path, 'utf8');
      reachedGate();
      return gate.then(() => real);
    };

    const signal = { abandoned: false };
    const drainO = drain(dirs, NOW, signal);
    await reached; // O has started reading sessions/s1.json; not yet delivered.

    // A « more recent pass » processes a Stop for the same session, in
    // full — final state: done_unseen.
    await dropEvent('3-1-Stop.json', hook('Stop', 3));
    await drain(dirs, NOW);
    expect((await readSessions(dirs)).get('s1')?.status).toBe('done_unseen');

    // The guardian (simulated here without a timer: this is exactly what
    // ReentrantGuard.run() does internally at the moment of the timeout) decides
    // to abandon O, then lets it resume with its stale read.
    signal.abandoned = true;
    releaseO();
    const resO = await drainO;
    readFileOverride.current = undefined;

    // Without the fix, O would here write its stale state (idle) over
    // done_unseen. With the fix, O consults `signal.abandoned` right before
    // the write-then-delete pair and gives up: nothing is written, nothing
    // is deleted — the invariant « write before deleting » allows this
    // abandonment without loss, the event will be reprocessed.
    const final = await readSessions(dirs);
    expect(final.get('s1')?.status).toBe('done_unseen');
    // O applied nothing itself: it gave up before writing.
    expect(resO.applied).toBe(0);
    // The fresh pass that processed the Stop also saw 2-1-PostToolUse.json
    // in its own listing (O had not yet deleted it) and so processed it
    // itself along the way — redundant but harmless reprocessing, consistent
    // with the lock-free convergence model. events/ is therefore empty:
    // the event was never lost, only processed by the other side.
    expect(readdirSync(dirs.events).filter((f) => f.endsWith('.json'))).toHaveLength(0);
  });

  it('is consulted again after the awaits a SessionEnd adds on the way to the write', async () => {
    // The first look at the signal sits BEFORE `hasTranscript` and `archive`
    // — two more awaits, for a SessionEnd only, between it and the write.
    // Abandoned during either, an execution used to reach the write with a
    // state read before the fresh pass ran, and put the conversation back to
    // ended over the prompt that had just woken it.
    await dropEvent('1-1-SessionStart.json', hook('SessionStart', 1));
    await drain(dirs, NOW);
    await dropEvent('2-1-SessionEnd.json', hook('SessionEnd', 2));

    let releaseO: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      releaseO = resolve;
    });
    let reachedGate: () => void = () => undefined;
    const reached = new Promise<void>((resolve) => {
      reachedGate = resolve;
    });
    let gated = false;
    const slowTranscript = async (): Promise<boolean> => {
      if (gated) return true;
      gated = true;
      reachedGate();
      await gate;
      return true;
    };
    const signal = { abandoned: false };
    const drainO = drain(dirs, NOW, signal, undefined, 'keep', slowTranscript);
    await reached; // O has read the state and is waiting on the transcript.

    // A fresh pass handles the end AND the prompt that followed it: the
    // conversation is running again, and the end is history.
    await dropEvent('3-1-UserPromptSubmit.json', hook('UserPromptSubmit', 3));
    await drain(dirs, NOW, undefined, undefined, 'keep', async () => true);
    expect((await readSessions(dirs)).get('s1')?.status).toBe('running');

    signal.abandoned = true;
    releaseO();
    const resO = await drainO;

    const final = (await readSessions(dirs)).get('s1');
    expect(final?.status).toBe('running');
    expect(final?.endedAt).toBeUndefined();
    expect(resO.applied).toBe(0);
  });

  it("without abandonment (signal.abandoned stays false), behaviour is unchanged: the event applies normally", async () => {
    await dropEvent('1-1-SessionStart.json', hook('SessionStart', 1));
    const signal = { abandoned: false };
    const res = await drain(dirs, NOW, signal);
    expect(res.applied).toBe(1);
    expect((await readSessions(dirs)).get('s1')?.startedAt).toBe(1);
  });
});

describe('drain — the tool calls it hands to the process view', () => {
  it('collects the Bash calls it applied, with the agent behind them, and nothing else', async () => {
    await dropEvent(
      '1-1-PreToolUse.json',
      hook('PreToolUse', 1, { tool_name: 'Bash', tool_input: { command: 'pnpm dev' }, agent_id: 'a1', agent_type: 'general-purpose' }),
    );
    // Not a Bash call: it starts no process, and the process view has no use for it.
    await dropEvent('2-1-PreToolUse.json', hook('PreToolUse', 2, { tool_name: 'Read', tool_input: { file_path: '/x' } }));
    await dropEvent('3-1-PostToolUse.json', hook('PostToolUse', 3, { tool_name: 'Bash', tool_input: { command: 'pnpm dev' } }));
    // Rejected, never applied — and so never handed over either.
    await dropEvent('4-1-PreToolUse.json', 'not an event');
    const res = await drain(dirs, NOW);
    expect(res.applied).toBe(3);
    expect(res.rejected).toBe(1);
    expect(res.toolCalls.map((c) => [c.event, c.toolTarget, c.agentId])).toEqual([
      ['PreToolUse', 'pnpm dev', 'a1'],
      ['PostToolUse', 'pnpm dev', undefined],
    ]);
  });
});

describe('SpoolWatcher', () => {
  it('start() tolerates a missing events folder, without throwing, and still arms the periodic safety net', () => {
    // Verified only structurally, never through the actual firing of start()'s
    // implicit `void this.tick()`: that background tick does exist (it aims to
    // consume whatever might already be sitting there), but observing it would
    // have required waiting for its resolution with no deterministic way to do
    // so — exactly the kind of timing dependency we eliminate, not reduce. The
    // behaviour « an event dropped afterwards is indeed consumed » is proven
    // separately below, without ever calling start().
    const missingDirs = spoolDirs(join(home, 'pas-encore-cree'));
    const onChange = vi.fn();
    const onError = vi.fn();
    const watcher = new SpoolWatcher(missingDirs, onChange, onError, () => NOW, async () => undefined, () => 'keep', async () => true);
    const internal = watcher as unknown as { watcher?: unknown; timer?: NodeJS.Timeout };

    expect(() => watcher.start()).not.toThrow();
    expect(internal.watcher).toBeUndefined(); // fs.watch failed on a missing folder
    expect(internal.timer).toBeDefined(); // the safety net is still armed

    watcher.stop();
  });

  it("an event dropped after the late appearance of the events folder is indeed consumed, driven by tick() (never by start()'s implicit void this.tick(), nor by the timer)", async () => {
    const missingDirs = spoolDirs(join(home, 'pas-encore-cree'));
    const onChange = vi.fn();
    const onError = vi.fn();
    const watcher = new SpoolWatcher(missingDirs, onChange, onError, () => NOW, async () => undefined, () => 'keep', async () => true);
    const internal = watcher as unknown as { tick: () => Promise<void> };

    // The events folder does not exist yet when this SpoolWatcher is
    // constructed (real scenario: the extension starts before any hook).
    // start() is never called here: its implicit void this.tick(), in the
    // background, would race with the explicit call below — this is exactly
    // the race the review measured (7 failures out of 10 full runs before
    // this fix). The folder appears afterwards (e.g. ensureDirs called
    // elsewhere), then an event is dropped into it.
    await ensureDirs(missingDirs);
    await writeFile(
      join(missingDirs.events, '1-1-SessionStart.json'),
      JSON.stringify(hook('SessionStart', 1)),
      'utf8',
    );

    await internal.tick();

    expect(onChange).toHaveBeenCalledTimes(1);
    expect((await readSessions(missingDirs)).get('s1')?.startedAt).toBe(1);
    expect(onError).not.toHaveBeenCalled();
  });

  it('stop() closes the FSWatcher and clears the safety-net timer; the trigger is driven by tick(), never by fs.watch or a delay', async () => {
    const onChange = vi.fn();
    const onError = vi.fn();
    const watcher = new SpoolWatcher(dirs, onChange, onError, () => NOW, async () => undefined, () => 'keep', async () => true);
    const internal = watcher as unknown as {
      watcher?: { close: () => void };
      timer?: NodeJS.Timeout;
      tick: () => Promise<void>;
    };

    try {
      // Consumption is proven by a direct call to tick(), on a watcher not
      // yet started: no implicit trigger from start() (itself a background
      // void this.tick()) can race with this call.
      await dropEvent('1-1-SessionStart.json', hook('SessionStart', 1));
      await internal.tick();
      expect(onChange).toHaveBeenCalledTimes(1);
      expect((await readSessions(dirs)).get('s1')?.startedAt).toBe(1);

      // fs.watch and the timer are verified only structurally — their
      // existence, then their actual closing by stop() — never by their
      // actual firing: waiting for a real fs.watch to notice a file is
      // exactly what made this test flaky (already observed failing once
      // in development).
      watcher.start();
      expect(internal.watcher).toBeDefined();
      expect(internal.timer).toBeDefined();
      const closeSpy = vi.spyOn(internal.watcher as { close: () => void }, 'close');

      watcher.stop();

      expect(closeSpy).toHaveBeenCalledOnce();
      expect(internal.watcher).toBeUndefined();
      expect(internal.timer).toBeUndefined();
    } finally {
      watcher.stop();
    }
  });

  it('the non-reentrancy guard loses no file: an event dropped during a drain ends up consumed', async () => {
    const onChange = vi.fn();
    const onError = vi.fn();
    const watcher = new SpoolWatcher(dirs, onChange, onError, () => NOW, async () => undefined, () => 'keep', async () => true);
    const internal = watcher as unknown as { guard: { running: boolean }; tick: () => Promise<void> };

    // Simulates a drain already in progress.
    internal.guard.running = true;
    await dropEvent('1-1-SessionStart.json', hook('SessionStart', 1));

    // A trigger that arrives during the drain is a no-op: nothing is lost.
    await internal.tick();
    expect(onChange).not.toHaveBeenCalled();
    expect(readdirSync(dirs.events).filter((f) => f.endsWith('.json'))).toHaveLength(1);

    // The ongoing drain finishes; the next trigger finds the file again.
    internal.guard.running = false;
    await internal.tick();

    expect(onChange).toHaveBeenCalledTimes(1);
    expect((await readSessions(dirs)).get('s1')?.startedAt).toBe(1);
    expect(readdirSync(dirs.events).filter((f) => f.endsWith('.json'))).toHaveLength(0);
  });

  it('if onChange throws, tick() does not reject: onError is called and the guard falls back, the next tick works', async () => {
    const onChange = vi.fn(() => {
      throw new Error('bug dans onChange');
    });
    const onError = vi.fn();
    const watcher = new SpoolWatcher(dirs, onChange, onError, () => NOW, async () => undefined, () => 'keep', async () => true);
    const internal = watcher as unknown as { guard: { running: boolean }; tick: () => Promise<void> };

    await dropEvent('1-1-SessionStart.json', hook('SessionStart', 1));
    await expect(internal.tick()).resolves.toBeUndefined();

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(internal.guard.running).toBe(false);

    // The next tick did not stay stuck because of the previous one's failure.
    onChange.mockReset();
    await dropEvent('2-1-Stop.json', hook('Stop', 2));
    await internal.tick();
    expect((await readSessions(dirs)).get('s1')?.status).toBe('done_unseen');
  });
});

describe('archiving a closed conversation', () => {
  it("archives the session it is about to delete, before deleting it ('remove' policy)", async () => {
    await dropEvent('1-1-SessionStart.json', hook('SessionStart', 1));
    await drain(dirs, NOW);

    const seen: Array<{ id: string; stillOnDisk: boolean }> = [];
    const archive = async (s: Session): Promise<void> => {
      seen.push({ id: s.id, stillOnDisk: existsSync(join(dirs.sessions, `${s.id}.json`)) });
    };

    await dropEvent('2-1-SessionEnd.json', hook('SessionEnd', 2));
    await drain(dirs, NOW, undefined, archive, 'remove');

    expect(seen).toEqual([{ id: 's1', stillOnDisk: true }]);
    expect(existsSync(join(dirs.sessions, 's1.json'))).toBe(false);
  });

  it('archives nothing for a SessionEnd whose session was never seen', async () => {
    const archive = vi.fn(async () => undefined);
    await dropEvent('1-1-SessionEnd.json', hook('SessionEnd', 1, { session_id: 'ghost' }));
    await drain(dirs, NOW, undefined, archive);
    expect(archive).not.toHaveBeenCalled();
  });


  it('leaves the event in place when archiving fails, so it is retried', async () => {
    await dropEvent('1-1-SessionStart.json', hook('SessionStart', 1));
    await drain(dirs, NOW);
    const failing = async (): Promise<void> => {
      throw new Error('disque plein');
    };
    await dropEvent('2-1-SessionEnd.json', hook('SessionEnd', 2));
    const res = await drain(dirs, NOW, undefined, failing);
    expect(res.deferred).toBe(1);
    expect(existsSync(join(dirs.sessions, 's1.json'))).toBe(true);
    expect(readdirSync(dirs.events).filter((f) => f.endsWith('.json'))).toHaveLength(1);
  });
});

describe("drain — the end policy (the 'persistent sessions' setting)", () => {
  it("'keep' leaves the row, ended, and archives it all the same", async () => {
    await dropEvent('1-1-SessionStart.json', hook('SessionStart', 1));
    await drain(dirs, NOW);
    const seen: string[] = [];
    await dropEvent('2-1-SessionEnd.json', hook('SessionEnd', 2));
    await drain(dirs, NOW, undefined, async (s) => void seen.push(s.id), 'keep');
    expect(seen).toEqual(['s1']);
    expect((await readSessions(dirs)).get('s1')?.endedAt).toBe(2);
  });

  it("'remove' takes a late SessionEnd at face value: closing the tab takes the row away", async () => {
    await dropEvent('1-1-SessionStart.json', hook('SessionStart', 1));
    await dropEvent('3-1-Stop.json', hook('Stop', 3));
    await drain(dirs, NOW);
    await dropEvent('2-1-SessionEnd.json', hook('SessionEnd', 2));
    await drain(dirs, NOW, undefined, undefined, 'remove');
    expect((await readSessions(dirs)).has('s1')).toBe(false);
  });

  it("'keep' ignores a late SessionEnd: a twin in another editor has spoken since", async () => {
    await dropEvent('1-1-SessionStart.json', hook('SessionStart', 1));
    await dropEvent('3-1-Stop.json', hook('Stop', 3));
    await drain(dirs, NOW);
    await dropEvent('2-1-SessionEnd.json', hook('SessionEnd', 2));
    await drain(dirs, NOW, undefined, undefined, 'keep');
    const s = (await readSessions(dirs)).get('s1');
    expect(s).not.toHaveProperty('endedAt');
    expect(s?.status).toBe('done_unseen');
  });

  it('the watcher hands the policy to every pass, as read at that moment', async () => {
    let policy: 'keep' | 'remove' = 'remove';
    const watcher = new SpoolWatcher(dirs, () => undefined, () => undefined, () => NOW, async () => undefined, () => policy, async () => true);
    const internal = watcher as unknown as { tick: () => Promise<void> };
    await dropEvent('1-1-SessionStart.json', hook('SessionStart', 1));
    await dropEvent('2-1-SessionEnd.json', hook('SessionEnd', 2));
    await internal.tick();
    expect((await readSessions(dirs)).has('s1')).toBe(false);

    policy = 'keep';
    await dropEvent('3-1-SessionStart.json', hook('SessionStart', 3));
    await dropEvent('4-1-SessionEnd.json', hook('SessionEnd', 4));
    await internal.tick();
    expect((await readSessions(dirs)).get('s1')?.endedAt).toBe(4);
  });
});

describe('drain — a conversation that never got a message', () => {
  it('drops the row on SessionEnd and archives nothing, whatever the policy: nothing to come back to', async () => {
    for (const policy of ['keep', 'remove'] as const) {
      await dropEvent('1-1-SessionStart.json', hook('SessionStart', 1));
      await drain(dirs, NOW);
      const seen: string[] = [];
      await dropEvent('2-1-SessionEnd.json', hook('SessionEnd', 2));
      await drain(dirs, NOW, undefined, async (s) => void seen.push(s.id), policy, async () => false);
      expect(seen, policy).toEqual([]);
      expect((await readSessions(dirs)).has('s1'), policy).toBe(false);
    }
  });

  it('keeps and archives one that has a transcript, under the keep policy', async () => {
    await dropEvent('1-1-SessionStart.json', hook('SessionStart', 1));
    await drain(dirs, NOW);
    const seen: string[] = [];
    await dropEvent('2-1-SessionEnd.json', hook('SessionEnd', 2));
    await drain(dirs, NOW, undefined, async (s) => void seen.push(s.id), 'keep', async () => true);
    expect(seen).toEqual(['s1']);
    expect((await readSessions(dirs)).get('s1')?.endedAt).toBe(2);
  });

  it('counts every end when nobody can tell — the probe is optional', async () => {
    await dropEvent('1-1-SessionStart.json', hook('SessionStart', 1));
    await drain(dirs, NOW);
    await dropEvent('2-1-SessionEnd.json', hook('SessionEnd', 2));
    await drain(dirs, NOW, undefined, undefined, 'keep');
    expect((await readSessions(dirs)).get('s1')?.endedAt).toBe(2);
  });
});
