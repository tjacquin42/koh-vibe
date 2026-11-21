/**
 * « Something is happening » between a click and its effect (14/11): a row
 * whose action is under way shows it at once, and keeps showing it until the
 * result is on screen.
 *
 * The result is on screen when the action has answered AND the next snapshot
 * has arrived — the one carrying what changed. Two caps keep a row from
 * spinning forever: `hold` after the answer when no snapshot comes (nothing
 * on disk changed, a link copied), and `MAX_MS` in all (a dialog left open).
 */
export const MAX_MS = 60_000;

export interface BusyEntry {
  since: number;
  /** Set once the action answered: from then on the next snapshot ends it. */
  answered?: number;
  hold: number;
}

export type Busy = ReadonlyMap<string, BusyEntry>;

export function startBusy(b: Busy, key: string, now: number, hold: number): Busy {
  return new Map(b).set(key, { since: now, hold });
}

export function answered(b: Busy, key: string, now: number): Busy {
  const e = b.get(key);
  if (e === undefined) return b;
  return new Map(b).set(key, { ...e, answered: now });
}

/** A snapshot arrived: every answered action is now visible. */
export function onSnapshot(b: Busy): Busy {
  if (![...b.values()].some((e) => e.answered !== undefined)) return b;
  return new Map([...b].filter(([, e]) => e.answered === undefined));
}

/** The caps: what waited too long after its answer, or too long at all. */
export function expire(b: Busy, now: number): Busy {
  const kept = [...b].filter(([, e]) => now - e.since < MAX_MS && (e.answered === undefined || now - e.answered < e.hold));
  return kept.length === b.size ? b : new Map(kept);
}
