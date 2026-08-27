import type { Session } from '../events/types';

/** How long a conversation left out of every folder stays without activity. */
export const TEMPORARY_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * The temporary conversations that have run their course: not filed in any
 * folder, and nothing happened in them for `ttl`. A folder is a keep — the
 * user sorted it, it stays whatever its age. A dormant tab has no age to
 * count, and a hidden row is already out.
 *
 * What the caller does with them is not decided here: an open one is hidden
 * (a removed file is exactly what the rescan brings back, and the next hook
 * lifts the hiding — "no activity for 24 h" is then exactly right), an ended
 * one is removed for good.
 */
export function temporaryToForget(
  sessions: Iterable<Session>,
  filed: (sessionId: string) => boolean,
  now: number,
  ttl: number = TEMPORARY_TTL_MS,
): Session[] {
  const out: Session[] = [];
  for (const s of sessions) {
    if (s.dormant === true || s.hidden === true) continue;
    if (filed(s.id)) continue;
    if (now - s.lastEventAt <= ttl) continue;
    out.push(s);
  }
  return out;
}
