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
  /** How long the indicator stays up at the very least. Defaults to MIN_BUSY_MS. */
  minMs?: number;
  /** Clock and sleep, injectable for the tests; the real ones by default. */
  now?: () => number;
  wait?: (ms: number) => Promise<void>;
}

/**
 * A rescan that finds everything already in place takes a few milliseconds.
 * Without a floor the spinner is a flicker nobody sees, and Refresh looks
 * like it did nothing — the very impression it exists to dispel.
 */
export const MIN_BUSY_MS = 600;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Runs `task` with the loading indicator on, and turns it off again whether
 * the task succeeded or failed — never before `minMs` have passed. The flag
 * itself is best effort: a context key that cannot be set must never hide
 * the result of the task — a refresh that found twelve conversations has
 * found them, spinner or not.
 */
export async function showBusy<T>(task: () => Promise<T>, deps: BusyDeps<T>): Promise<T> {
  const now = deps.now ?? Date.now;
  const wait = deps.wait ?? sleep;
  const minMs = deps.minMs ?? MIN_BUSY_MS;
  const started = now();
  await flag(deps, true);
  try {
    return await deps.progress(task);
  } finally {
    const remaining = minMs - (now() - started);
    if (remaining > 0) await wait(remaining);
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
