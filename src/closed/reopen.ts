import * as vscode from 'vscode';
import type { ClosedEntry } from './model';
import { sessionLabel } from '../ui/labels';

export type ReopenPlan =
  | { kind: 'command'; command: string; args: readonly string[] }
  | { kind: 'terminal'; cwd: string; name: string; command: string }
  | { kind: 'explain'; message: string };

/**
 * The only rule that decides how a closed conversation comes back. Twin of
 * `focusPlan`, and it follows the same discipline: an absent or invalid origin
 * NEVER falls back to a guessed command — reopening something the user did not
 * ask for is worse than explaining that we cannot.
 *
 * `origin` is not typed `Origin`: the remote path — the window consuming a
 * request written by another one — has only what an untrusted JSON file
 * carried, not a `ClosedEntry`.
 *
 * The session id reaches a command line in the terminal branch. It is safe
 * because every id has passed `isValidSessionId` twice: once at the spool
 * boundary, once when `closed.json` was read back.
 */
export function reopenPlan(origin: unknown, sessionId: string, cwd: string, label: string, listed: boolean): ReopenPlan {
  const terminal: ReopenPlan = { kind: 'terminal', cwd, name: label, command: `claude --resume ${sessionId}` };
  if (origin === 'vscode' || origin === 'desktop') {
    // `listed`: whether Claude Code's session list, in the window that runs
    // the command, holds this id (claude/listed.ts). When it does not, the
    // command starts a BLANK conversation — observed — and a terminal is the
    // only way back: `claude --resume` finds a conversation by its id across
    // every project.
    return listed ? { kind: 'command', command: 'claude-vscode.editor.open', args: [sessionId] } : terminal;
  }
  if (origin === 'terminal') return terminal;
  const suffix = typeof origin === 'string' && origin.length > 0 ? ` (${origin})` : '';
  return {
    kind: 'explain',
    message: vscode.l10n.t('Koh-Vibe: « {0} » ran outside the editor and the terminal{1} — nothing to reopen here.', label, suffix),
  };
}

/**
 * Executes what a click on a closed conversation's row asks for. Extracted
 * of the click on an ended row (`kohVibe.focusSession`, extension.ts) for
 * the same reason `acknowledgeVisibleSessions`/`acknowledgeClickedSession`
 * were pulled out of extension.ts's onVisible/focusSession — see
 * `focus/acknowledge.ts`'s header comment: a composition point living
 * directly in extension.ts has no automated coverage, and a reviewer has
 * already proven by mutation, on this exact codebase, that a broken call
 * site can compile and stay green while only the pure primitive underneath
 * (here, `reopenPlan`) is tested.
 *
 * `requestReopen` is injected rather than importing `FocusBroker` directly —
 * the same shape as `checkHooksInstalled`/`onDrop` on `SessionsTree`, or the
 * `archive` callback on `SpoolWatcher`: this function does not need to know
 * HOW a `command`-kind plan reaches another window, only that something
 * does, so a test can drive it without constructing a broker.
 *
 * The `terminal` case is handled HERE, not delegated to `requestReopen`:
 * `FocusBroker.requestReopen` deliberately does nothing for it — the caller
 * opens the terminal locally, before `requestReopen` is even invoked.
 */
/**
 * A fresh terminal on the conversation's folder, resuming it. Fresh: the old
 * one is gone, and koh-vibe does not know which one it was.
 */
export function openResumeTerminal(plan: { cwd: string; name: string; command: string }): void {
  const terminal = vscode.window.createTerminal({ cwd: plan.cwd, name: plan.name });
  terminal.sendText(plan.command);
  terminal.show();
}

/**
 * What a reopen did: whether anything is now on its way. `explain` and
 * `failed` mean nothing is — the caller shows no wait for them.
 */
export type ReopenOutcome = 'terminal' | 'editor' | 'explain' | 'failed';

export async function reopenClosedSession(
  entry: ClosedEntry,
  requestReopen: (e: ClosedEntry) => Promise<void>,
): Promise<ReopenOutcome> {
  // `listed` is the broker's question, asked in the window that will run the
  // command; here it only sorts the origins, so `true` keeps the editor ones
  // on the editor path.
  const plan = reopenPlan(entry.origin, entry.id, entry.cwd, sessionLabel(entry), true);
  if (plan.kind === 'explain') {
    void vscode.window.showInformationMessage(plan.message);
    return 'explain';
  }
  if (plan.kind === 'terminal') {
    openResumeTerminal(plan);
    return 'terminal';
  }
  // The tab can only come back in a window that holds the project: the
  // broker takes care of that, locally or by request. The catch stays — an
  // unhandled rejection would be worse — but a silently swallowed failure
  // here (full disk, `requests/` removed at runtime) would leave the click
  // doing and saying nothing, on a section whose only gesture IS this one.
  return requestReopen(entry).then(
    () => 'editor' as const,
    () => {
      void vscode.window.showErrorMessage(
        vscode.l10n.t('Koh-Vibe: could not reopen « {0} ».', sessionLabel(entry)),
      );
      return 'failed' as const;
    },
  );
}
