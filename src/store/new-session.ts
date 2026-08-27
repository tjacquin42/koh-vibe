import type { Session } from '../events/types';

/**
 * The conversation that appeared since `before` was taken — the one a "new
 * session" click just opened, so that it can be filed where the click came
 * from. `isMine` keeps out what another window or a terminal may have started
 * in the meantime; among several candidates the earliest wins, since the tab
 * this window opened started first.
 */
export function newSessionAmong(
  before: ReadonlySet<string>,
  now: ReadonlyMap<string, Session>,
  isMine: (s: Session) => boolean,
): string | undefined {
  let found: Session | undefined;
  for (const s of now.values()) {
    if (before.has(s.id) || !isMine(s)) continue;
    const at = s.startedAt ?? s.lastEventAt;
    if (found === undefined || at < (found.startedAt ?? found.lastEventAt)) found = s;
  }
  return found?.id;
}
