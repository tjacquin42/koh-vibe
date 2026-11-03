import type { Session } from '../events/types';

/** How long a conversation left out of every folder stays without activity. */
export const TEMPORARY_TTL_MS = 24 * 60 * 60 * 1000;

/** What leaves with the day: ended rows to remove, open ones whose tab to close. */
export interface Expiry {
  remove: Session[];
  close: Session[];
}

/**
 * The temporary conversations that have run their course: not filed in any
 * folder, and nothing happened in them for `ttl`. A folder is a keep — the
 * user sorted it, it stays whatever its age. A dormant tab has no age to
 * count.
 *
 * An ended one is removed: nothing runs behind it. An open one leaves WITH its
 * tab, or not at all. It used to be hidden while its tab stayed open, and the
 * tab outlived its row — on screen, and out of reach of the dashboard. So it
 * is closed only when this window can tell its tab apart (`located`), never
 * through a reveal that would pull it to the front under the user's typing;
 * failing that, the row stays in the list, where a click can still close it.
 *
 * A row hidden by that old rule is still considered for the close, so the
 * orphans it left behind go too. A hidden one with nothing to close is left
 * as it is.
 */
export function temporaryToExpire(
  sessions: Iterable<Session>,
  filed: (sessionId: string) => boolean,
  located: (sessionId: string) => boolean,
  now: number,
  ttl: number = TEMPORARY_TTL_MS,
): Expiry {
  const out: Expiry = { remove: [], close: [] };
  for (const s of sessions) {
    if (s.dormant === true) continue;
    if (filed(s.id)) continue;
    if (now - s.lastEventAt <= ttl) continue;
    if (s.endedAt !== undefined) {
      if (s.hidden !== true) out.remove.push(s);
    } else if (located(s.id)) out.close.push(s);
  }
  return out;
}
