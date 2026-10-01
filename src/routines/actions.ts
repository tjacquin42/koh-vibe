import * as vscode from 'vscode';
import type { Routine } from './model';
import { isSpent } from './schedule';

/** What an action calls on claude.ai. */
export interface RoutineCalls {
  run: (id: string) => Promise<boolean>;
  setEnabled: (id: string, enabled: boolean) => Promise<boolean>;
  /** Reads the list again, forced: the view shows what the server says, never what we hoped. */
  refresh: () => Promise<void>;
}

/** What an action says to the person — injected, so the sequence is testable without an editor. */
export interface RoutineUi {
  /** The modal before a run: true only on the explicit confirmation. */
  confirmRun: (routine: Routine) => Promise<boolean>;
  /** A short-lived word in the status bar. */
  done: (message: string) => void;
  /** A run is on its way: a notification that can open the routine's page, where its runs are listed. */
  launched: (routine: Routine) => void;
  /** Something did not go through: a warning that can open the routine's page. */
  failed: (message: string, routine: Routine) => void;
}

export type RunOutcome = 'cancelled' | 'launched' | 'failed';

/**
 * Runs a routine now, after a confirmation: a run acts for real — messages
 * sent, commits pushed, whatever its prompt says.
 */
export async function launchRoutine(r: Routine, calls: RoutineCalls, ui: RoutineUi): Promise<RunOutcome> {
  // Only an active routine is offered the button (package.json); a stale row
  // must not get past that either — the server refuses to run a paused one.
  if (!r.enabled || r.fired) return 'cancelled';
  if (!(await ui.confirmRun(r))) return 'cancelled';
  const ok = await calls.run(r.id);
  if (ok) ui.launched(r);
  else ui.failed(vscode.l10n.t('Could not launch “{0}”.', r.name), r);
  await calls.refresh();
  return ok ? 'launched' : 'failed';
}

export type PauseOutcome = 'skipped' | 'done' | 'failed';

/**
 * Pauses (`paused`) or resumes a routine. No confirmation: both undo each
 * other — which is why a spent one-shot is never resumed (`isSpent`): that one
 * might run at once, and a run is not undone.
 */
export async function pauseRoutine(
  r: Routine,
  paused: boolean,
  calls: RoutineCalls,
  ui: RoutineUi,
  now: number,
): Promise<PauseOutcome> {
  if (paused === !r.enabled || (!paused && isSpent(r, now))) return 'skipped';
  const ok = await calls.setEnabled(r.id, !paused);
  if (ok) {
    ui.done(paused ? vscode.l10n.t('Koh-Vibe: “{0}” paused', r.name) : vscode.l10n.t('Koh-Vibe: “{0}” resumed', r.name));
  } else {
    ui.failed(paused ? vscode.l10n.t('Could not pause “{0}”.', r.name) : vscode.l10n.t('Could not resume “{0}”.', r.name), r);
  }
  await calls.refresh();
  return ok ? 'done' : 'failed';
}
