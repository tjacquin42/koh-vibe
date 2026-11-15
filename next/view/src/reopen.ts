/**
 * The wait after a click that brings a conversation back: a « Recently
 * closed » row, or a greyed one in the sessions.
 *
 * V1 does the resuming (open-session.ts on the host side); this only decides
 * how long the row shows a spinner: until the conversation is open again —
 * back among the open sessions (15/11), not merely off the closed list, where
 * it can pass through a greyed row first. At most a minute: a resume that
 * never comes must not spin forever, and one that opens a window on its
 * project takes that window's start. One more way out: the conversation gone
 * from both lists, with no row left to spin.
 */
import type { Snapshot } from '../../src/shared/protocol';

/** Twice V1's own wait: a resume may have to open a window first. */
export const REOPEN_WAIT_MS = 60_000;

/** Conversation id → when the click asked for it. */
export type Reopening = ReadonlyMap<string, number>;

export function startReopening(r: Reopening, sessionId: string, now: number): Reopening {
  return new Map(r).set(sessionId, now);
}

export function stopReopening(r: Reopening, sessionId: string): Reopening {
  if (!r.has(sessionId)) return r;
  const next = new Map(r);
  next.delete(sessionId);
  return next;
}

/** The waits still running. The same map when none ended. */
export function settleReopening(r: Reopening, snapshot: Snapshot, now: number): Reopening {
  if (r.size === 0) return r;
  const live = new Set(snapshot.sessions.filter((s) => s.endedAt === undefined).map((s) => s.id));
  const listed = new Set([...snapshot.closed.map((c) => c.sessionId), ...snapshot.sessions.map((s) => s.id)]);
  let next: Map<string, number> | undefined;
  for (const [id, since] of r) {
    if (live.has(id) || !listed.has(id) || now - since > REOPEN_WAIT_MS) {
      next ??= new Map(r);
      next.delete(id);
    }
  }
  return next ?? r;
}
