import type { Session } from '../events/types';

/**
 * What the dashboard shows: every session but the hidden ones. A new map,
 * never a mutation — the full map is still what the closed view and the
 * rescan reason about, since a hidden conversation is alive all the same.
 */
export function visibleSessions(all: ReadonlyMap<string, Session>): Map<string, Session> {
  return new Map([...all].filter(([, s]) => s.hidden !== true));
}
