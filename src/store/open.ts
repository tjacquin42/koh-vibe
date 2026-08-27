import type { Session } from '../events/types';

/**
 * How many ended conversations the list keeps. The ten of the former
 * "Recently closed" view, doubled: they no longer sit in a view of their own
 * but in the folders they were filed in, where twenty greyed rows are still
 * a history rather than a heap. Beyond it the oldest ended one goes
 * (`capEndedSessions`); an open conversation is never touched by this.
 */
// Generous on purpose: quitting the editor ends every tab at once, and a
// user who keeps twenty tabs open must find all twenty greyed out — not the
// oldest gone — when the editor comes back.
export const MAX_ENDED = 50;

/** Open: a process behind it — neither ended nor a tab nobody has woken. */
export function isOpen(s: Session): boolean {
  return s.endedAt === undefined && s.dormant !== true;
}

export function openSessions(all: ReadonlyMap<string, Session>): Map<string, Session> {
  return new Map([...all].filter(([, s]) => isOpen(s)));
}
