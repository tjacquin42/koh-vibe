/**
 * The wait after a click on a « Recently closed » row.
 *
 * V1 does the resuming (open-session.ts on the host side); this only decides
 * how long the row shows a spinner. Same rules as V1's own wait
 * (src/ui/reopening.ts): until the conversation is live again, and at most
 * 30 seconds — a resume that never comes must not spin forever. One more way
 * out here: V1 dropping the row from its list, which it does once it has the
 * conversation back.
 */
import type { Snapshot } from '../../src/shared/protocol';

/** V1's REOPEN_WAIT_MS. */
export const REOPEN_WAIT_MS = 30_000;

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
  const listed = new Set(snapshot.closed.map((c) => c.sessionId));
  let next: Map<string, number> | undefined;
  for (const [id, since] of r) {
    if (live.has(id) || !listed.has(id) || now - since > REOPEN_WAIT_MS) {
      next ??= new Map(r);
      next.delete(id);
    }
  }
  return next ?? r;
}
