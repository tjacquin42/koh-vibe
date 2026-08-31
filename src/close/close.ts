import type { Session, Status } from '../events/types';
import { closePlan } from './plan';
import type { CloseOutcome } from './tabs';

/**
 * Closing a tab ENDS the conversation behind it. Two statuses make that
 * destructive: `running` (the agent is working) and `waiting` (it is waiting
 * for an answer). The other three interrupt nothing — a confirmation on the
 * gesture one repeats most would only teach the user to dismiss it.
 */
export function needsConfirmation(status: Status): boolean {
  return status === 'running' || status === 'waiting';
}

export interface RequestCloseDeps {
  /** Asks the user; `false` cancels everything. */
  confirm: (s: Session) => Promise<boolean>;
  /** Sends the close to the window that holds the project (the broker). */
  route: (s: Session) => Promise<void>;
  /** Removes the row, closing nothing and archiving nothing. */
  forget: (id: string) => Promise<void>;
}

/**
 * What the window where the user CLICKED does, in this order: decide, then
 * ask, then route.
 *
 * The order matters twice. A `forget` plan never asks — nothing is being cut,
 * only a row removed. And the confirmation is raised HERE, before any request
 * travels: shown by the window that ends up closing the tab, it would appear
 * somewhere the user is not looking.
 */
export async function requestCloseSession(s: Session, deps: RequestCloseDeps): Promise<void> {
  if (closePlan(s.origin).kind === 'forget') {
    await deps.forget(s.id);
    return;
  }
  if (needsConfirmation(s.status) && !(await deps.confirm(s))) return;
  await deps.route(s);
}

export interface CloseHereDeps {
  read: (id: string) => Promise<Session | undefined>;
  closeTab: (id: string) => Promise<CloseOutcome>;
  archive: (s: Session) => Promise<void>;
  /** Removes the row, closing nothing and archiving nothing — it may still run elsewhere. */
  forget: (id: string) => Promise<void>;
  /**
   * Removes the row for good: its tab was just closed. Not `forget`, which
   * only hides an open row — and the `SessionEnd` the closed tab sends a
   * moment later would lift that hiding, and the row would come back greyed.
   */
  remove: (id: string) => Promise<void>;
}

/**
 * What the window that HOLDS the project does — whether the click happened
 * there or a `close-` request brought it.
 *
 * The session is read from the shared spool because the consuming window has
 * only what the request file carried, never a `Session` object. If the state
 * file has already gone, there is nothing to archive and the row is simply
 * removed.
 *
 * Archiving is what makes this gesture independent of the still-unanswered
 * question "does `SessionEnd` fire when a tab is closed?": koh-vibe does the
 * archiving itself. Should the hook fire afterwards anyway, `remember`
 * deduplicates by id and `removeSession` tolerates a missing file.
 *
 * `notFound` archives NOTHING: no tab was closed, so the conversation is still
 * running somewhere. Filing it under "recently closed" would claim an ending
 * that never happened.
 */
export async function closeSessionHere(sessionId: string, deps: CloseHereDeps): Promise<void> {
  const s = await deps.read(sessionId);
  if (s === undefined) {
    await deps.forget(sessionId);
    return;
  }
  const outcome = await deps.closeTab(sessionId);
  if (outcome === 'closed') {
    await deps.archive(s);
    await deps.remove(sessionId);
    return;
  }
  await deps.forget(sessionId);
}

export interface SleepHereDeps {
  read: (id: string) => Promise<Session | undefined>;
  closeTab: (id: string) => Promise<CloseOutcome>;
  /** Marks the row ended, and leaves it in the list — where it greys out. */
  markEnded: (s: Session, at: number) => Promise<void>;
  now: () => number;
}

/**
 * Putting a conversation to sleep, in the window that holds its project.
 *
 * The quiet twin of `closeSessionHere`. Both close the tab; what they do with
 * the row is the whole difference. The trash removes it and files the
 * conversation under "recently closed" — the conversation has left the
 * dashboard. The moon leaves the row exactly where it was, in its folder,
 * greyed: it is still yours, a click still reopens it.
 *
 * Nothing is archived here, and that is deliberate: a row that is still on the
 * list AND in the closed history would show the same conversation in two
 * places. Should Claude Code send a `SessionEnd` of its own once the tab is
 * gone, the drain archives it then — that is a real ending, and `remember`
 * deduplicates by id anyway.
 *
 * The row is marked ended rather than left to that hypothetical `SessionEnd`,
 * because whether the hook fires when a tab closes is the same unanswered
 * question `closeSessionHere` names. A moon that greyed nothing half the time
 * would read as a broken button.
 *
 * `notFound` marks NOTHING, for the reason the trash archives nothing then: no
 * tab was closed, so the conversation is still running, and grey would be a
 * lie about it.
 */
export async function sleepSessionHere(sessionId: string, deps: SleepHereDeps): Promise<void> {
  const s = await deps.read(sessionId);
  // Already asleep, or gone from the list entirely: no tab of ours to close.
  if (s === undefined || s.endedAt !== undefined) return;
  if ((await deps.closeTab(sessionId)) !== 'closed') return;
  await deps.markEnded(s, deps.now());
}
