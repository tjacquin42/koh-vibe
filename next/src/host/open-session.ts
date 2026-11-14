import type { ClosedEntry } from '../../../src/closed/model';
import type { Session } from '../../../src/events/types';
import type { ReopenOutcome } from '../shared/protocol';

/** V1's row click (extension.ts `kohVibe.focusSession`): acknowledge, then bring the tab forward. */
export const V1_FOCUS_COMMAND = 'kohVibe.focusSession';

export interface OpenSessionDeps {
  /** The session as V1 stored it — V1's command takes its own type, not the view's. */
  read(sessionId: string): Promise<Session | undefined>;
  hasCommand(command: string): Promise<boolean>;
  run(command: string, arg: Session): Thenable<unknown>;
  /** When V1 cannot take it: the cockpit, on that conversation. */
  fallback(sessionId: string): void;
}

/**
 * A click on a conversation, while V1 is installed.
 *
 * Opening a conversation is not a read: V1 acknowledges it (writes to the
 * spool) and asks the window holding its tab to bring it forward. Doing that
 * here would make two writers of the same spool, which the read-only rule of
 * this stage exists to avoid. So the click is handed to V1's own command —
 * the very thing a click in V1's list does — and V1 stays the only writer.
 *
 * Without V1 (uninstalled, disabled, or a session file gone), the click falls
 * back to the cockpit. Step 5 replaces this with the V2's own opening.
 */
export async function openSession(sessionId: string, deps: OpenSessionDeps): Promise<'v1' | 'fallback'> {
  const [session, available] = await Promise.all([deps.read(sessionId), deps.hasCommand(V1_FOCUS_COMMAND)]);
  if (session === undefined || !available) {
    deps.fallback(sessionId);
    return 'fallback';
  }
  try {
    await deps.run(V1_FOCUS_COMMAND, session);
    return 'v1';
  } catch {
    deps.fallback(sessionId);
    return 'fallback';
  }
}

/** V1's click on a « Recently closed » row (extension.ts `kohVibe.reopenSession`). */
export const V1_REOPEN_COMMAND = 'kohVibe.reopenSession';

export interface ReopenDeps {
  /** The entry as V1 stored it in closed.json — its command takes its own type. */
  read(sessionId: string): Promise<ClosedEntry | undefined>;
  hasCommand(command: string): Promise<boolean>;
  run(command: string, arg: ClosedEntry): Thenable<unknown>;
}

/**
 * A click on a closed conversation, while V1 is installed.
 *
 * Resuming writes: V1 drops the row from closed.json once the conversation is
 * back, and may ask another window to open it. Same rule as `openSession`:
 * V1's own command does it, V1 stays the only writer. V1 also decides HOW it
 * comes back (editor tab, terminal running `claude --resume`, or a message
 * saying it cannot), so nothing of that is guessed here.
 *
 * There is no fallback this time: without V1, resuming would be the V2's
 * first write. The view says it is not possible yet.
 */
export async function reopenClosed(sessionId: string, deps: ReopenDeps): Promise<ReopenOutcome> {
  const [entry, available] = await Promise.all([deps.read(sessionId), deps.hasCommand(V1_REOPEN_COMMAND)]);
  if (!available) return 'unavailable';
  if (entry === undefined) return 'gone';
  try {
    await deps.run(V1_REOPEN_COMMAND, entry);
    return 'v1';
  } catch {
    return 'failed';
  }
}
