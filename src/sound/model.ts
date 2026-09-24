import type { Session, Status } from '../events/types';

/**
 * The event that deserves a sound, and its setting.
 *
 * Not "every status change": a session goes from `running` to `idle` on its
 * own without anything having happened for the user, and a chime at every
 * such step would become background noise
 * that one learns to ignore — hence a dead signal. Only the two
 * transitions that call for action ring.
 */
export type ChimeEvent = 'waiting' | 'done';

const EVENT_OF: Partial<Record<Status, ChimeEvent>> = {
  waiting: 'waiting',
  done_unseen: 'done',
};

export function statusesOf(sessions: ReadonlyMap<string, Session>): Map<string, Status> {
  return new Map([...sessions].map(([id, s]) => [id, s.status]));
}

/** What flipped, and which one: the sound then resolves against this session. */
export interface Chime {
  event: ChimeEvent;
  sessionId: string;
}

/**
 * Which flip deserves a sound, if any.
 *
 * `before === undefined` is the FIRST render: everything in it looks like a
 * transition, and ringing would make the editor chime on every window open
 * for sessions sometimes hours old. The first render only sets the
 * reference.
 *
 * A session unknown to `before` but present afterwards does not ring
 * either: it just appeared in the spool, and we don't know where it came
 * from.
 *
 * Only one flip is kept per turn, even if several occur: two simultaneous
 * chimes are not heard any better than one. « Waiting » wins over
 * « Done » — it's the one that asks for something.
 */
export function chimeFor(
  before: ReadonlyMap<string, Status> | undefined,
  after: ReadonlyMap<string, Status>,
): Chime | undefined {
  if (before === undefined) return undefined;
  let found: Chime | undefined;
  for (const [sessionId, status] of after) {
    const was = before.get(sessionId);
    if (was === undefined || was === status) continue;
    const event = EVENT_OF[status];
    if (event === 'waiting') return { event, sessionId };
    if (event !== undefined) found ??= { event, sessionId };
  }
  return found;
}
