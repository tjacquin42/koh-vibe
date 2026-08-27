/**
 * What surrounds a task the user should see running: the flag the view's
 * title reads (a spinning icon takes the place of the Refresh button while it
 * is raised — see the `kohVibe.rescanning` context key in package.json) and
 * the view's own progress indication, which the task runs inside.
 *
 * Injected rather than imported from `vscode`, so that the ORDER — raise,
 * run, lower, whatever happened — is tested without an editor.
 */
export interface BusyDeps<T> {
  setBusy: (busy: boolean) => PromiseLike<unknown>;
  progress: (task: () => Promise<T>) => PromiseLike<T>;
}

/**
 * Runs `task` with the loading indicator on, and turns it off again whether
 * the task succeeded or failed. The flag itself is best effort: a context key
 * that cannot be set must never hide the result of the task — a refresh that
 * found twelve conversations has found them, spinner or not.
 */
export async function showBusy<T>(task: () => Promise<T>, deps: BusyDeps<T>): Promise<T> {
  await flag(deps, true);
  try {
    return await deps.progress(task);
  } finally {
    await flag(deps, false);
  }
}

async function flag<T>(deps: BusyDeps<T>, busy: boolean): Promise<void> {
  try {
    await deps.setBusy(busy);
  } catch {
    // The indicator is decoration; the task is the point.
  }
}
