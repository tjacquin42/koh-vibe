/**
 * The wait after a click that brings a conversation forward: a row in the
 * sessions, live or greyed, or a « Recently closed » one.
 *
 * V1 does the work (open-session.ts on the host side); this only decides how
 * long the row shows a spinner: until the click has had its whole effect
 * (15/11) — a conversation of the editor open again AND its tab in front, one
 * elsewhere (a terminal) open again. Even a live conversation takes a moment
 * to show its tab, and a row that says nothing in the meantime reads as a
 * click that was lost.
 *
 * At most a minute: a wait that never ends must not spin forever, and one
 * that opens a window on its project takes that window's start. One more
 * way out: the conversation gone from both lists, with no row left to spin.
 */
import type { Snapshot } from '../../src/shared/protocol';

/** Twice V1's own wait: a resume may have to open a window first. */
export const REOPEN_WAIT_MS = 60_000;

/** What ends a wait: the conversation open again, or open with its tab in front. */
export type WaitUntil = 'open' | 'front';

export interface Wait {
  readonly since: number;
  readonly until: WaitUntil;
}

/** Conversation id → its wait. */
export type Reopening = ReadonlyMap<string, Wait>;

export function startReopening(r: Reopening, sessionId: string, now: number, until: WaitUntil = 'open'): Reopening {
  return new Map(r).set(sessionId, { since: now, until });
}

export function stopReopening(r: Reopening, sessionId: string): Reopening {
  if (!r.has(sessionId)) return r;
  const next = new Map(r);
  next.delete(sessionId);
  return next;
}

/** The waits still running. The same map when none ended. `activeId`: the conversation whose tab is in front. */
export function settleReopening(r: Reopening, snapshot: Snapshot, now: number, activeId?: string): Reopening {
  if (r.size === 0) return r;
  const live = new Set(snapshot.sessions.filter((s) => s.endedAt === undefined).map((s) => s.id));
  const listed = new Set([...snapshot.closed.map((c) => c.sessionId), ...snapshot.sessions.map((s) => s.id)]);
  let next: Map<string, Wait> | undefined;
  for (const [id, wait] of r) {
    // In front here, or taken forward by another window: this one lost the focus to it.
    const arrived = live.has(id) && (wait.until === 'open' || activeId === id || snapshot.focused === false);
    if (arrived || !listed.has(id) || now - wait.since > REOPEN_WAIT_MS) {
      next ??= new Map(r);
      next.delete(id);
    }
  }
  return next ?? r;
}
