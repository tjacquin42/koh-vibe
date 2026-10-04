import * as vscode from 'vscode';
import type { Session } from '../events/types';
import { isEditorOrigin } from '../events/origin';
import { sessionLabel } from '../ui/labels';

export type FocusPlan =
  | { kind: 'command'; command: string; args: readonly string[] }
  | { kind: 'explain'; message: string };

/**
 * The only rule that decides what to do with a session: vscode/desktop
 * reveal a panel, everything else — including an absent or invalid origin
 * (a request written by an earlier version of the broker) — opens NO
 * context. Opening a conversation the user did not ask for is precisely
 * the defect this batch fixes, so `explain` is the safe fallback, never a
 * guessed command.
 *
 * `origin` is not typed `Origin`: the remote path (the broker consuming a
 * request written by another window) only has what an untrusted JSON file
 * chose to carry, not a `Session`. `focusPlanFor` below is the only caller
 * that does have an already-typed value.
 */
export function focusPlan(sessionId: string, origin: unknown, label: string): FocusPlan {
  if (isEditorOrigin(origin)) {
    return { kind: 'command', command: 'claude-vscode.editor.open', args: [sessionId] };
  }
  const suffix = typeof origin === 'string' && origin.length > 0 ? ` (${origin})` : '';
  return {
    kind: 'explain',
    // Through `vscode.l10n.t` like every other user-facing string: the English
    // literal is the default, the French lives in the bundle — same rule as
    // its twin `reopenPlan` (closed/reopen.ts).
    message: vscode.l10n.t('Koh-Vibe: session « {0} » runs outside the editor{1} — nothing to open here.', label, suffix),
  };
}

/** What to do when a session is clicked, from the window that claims it. */
export function focusPlanFor(s: Session): FocusPlan {
  return focusPlan(s.id, s.origin, sessionLabel(s));
}
