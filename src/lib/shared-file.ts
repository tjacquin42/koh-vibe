import { readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/**
 * The write machinery shared by every state file that several windows edit
 * concurrently (`groups.json`, `closed.json`). It was duplicated verbatim in
 * `groups/store.ts` and `closed/store.ts`; a fix landing in one copy could be
 * forgotten in the other — the exact precedent that produced `ReentrantGuard`.
 *
 * What lives here is the mechanism only: the per-file queue, the re-read →
 * merge → write-if-unchanged loop, the atomic rename. What "merge" MEANS —
 * three-way for the folders, re-apply for the closed history — stays with each
 * store, passed in as `mergeWith`.
 */

/**
 * Maximum number of MERGE ROUNDS attempted (re-read → merge → write → check).
 * Never bounds the number of CHECKS: every round, without exception, re-reads
 * just before renaming. If all `MAX_ATTEMPTS` rounds saw a change, one last
 * round merges the freshest state and writes it without reading once more —
 * we leave the loop having merged the latest content, never by ignoring what
 * we just read.
 */
const MAX_ATTEMPTS = 3;

let seq = 0;

/**
 * Serialises tasks on one file WITHIN THIS PROCESS: two calls started from the
 * same window (e.g. a drop of several sessions at once) never run concurrently
 * with each other, the second waits for the first. Does not protect against
 * ANOTHER window (another process): `commitMerged` handles that with its own
 * re-read just before renaming.
 *
 * The queue never stays stuck on a failing call: `run` can reject (the caller
 * receives the error), but the entry stored in `queues` for the NEXT call is
 * derived from a version of `run` whose rejection is absorbed (`.then(ok, ok)`)
 * — so the next call starts regardless of what happened to the previous one.
 */
const queues = new Map<string, Promise<void>>();

export function withFileQueue<T>(file: string, task: () => Promise<T>): Promise<T> {
  const previous = queues.get(file) ?? Promise.resolve();
  const settled = previous.then(
    () => undefined,
    () => undefined,
  );
  const run = settled.then(task);
  queues.set(
    file,
    run.then(
      () => undefined,
      () => undefined,
    ),
  );
  return run;
}

/** An absent or unreadable file reads as `undefined`; the parser decides what that means. */
export async function readRaw(file: string): Promise<string | undefined> {
  try {
    return await readFile(file, 'utf8');
  } catch {
    return undefined;
  }
}

/**
 * Commits the result of `mergeWith` to `file`, re-merging as long as another
 * process writes underneath us — up to `MAX_ATTEMPTS` rounds, then one final
 * unconditional write of the freshest merge (see `MAX_ATTEMPTS`).
 *
 * `mergeWith` receives the freshest raw content observed and must return the
 * full state to write; it is called once per round, so it must be cheap and
 * side-effect free.
 */
export async function commitMerged<S>(
  file: string,
  tmpPrefix: string,
  mergeWith: (latestRaw: string | undefined) => S,
  serialize: (s: S) => string,
): Promise<S> {
  let latestRaw = await readRaw(file);
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const merged = mergeWith(latestRaw);
    const outcome = await writeIfUnchanged(file, tmpPrefix, serialize(merged), latestRaw);
    if (outcome.committed) return merged;
    latestRaw = outcome.raw;
  }
  const merged = mergeWith(latestRaw);
  await writeUnconditionally(file, tmpPrefix, serialize(merged));
  return merged;
}

/**
 * Writes to a temporary file, re-reads the target, and renames only if its
 * content is still the expected one.
 *
 * The outcome is a tagged object, never `raw` alone: the previous inlined
 * versions returned the fresh content directly, with `undefined` meaning
 * "committed" — but `undefined` is ALSO what `readRaw` returns for a file
 * deleted underneath us, and that collision silently dropped the write (the
 * caller believed it committed while the temporary file had been discarded).
 */
async function writeIfUnchanged(
  file: string,
  tmpPrefix: string,
  content: string,
  expectedRaw: string | undefined,
): Promise<{ committed: true } | { committed: false; raw: string | undefined }> {
  const tmp = tmpPath(file, tmpPrefix);
  try {
    await writeFile(tmp, content, 'utf8');
    const checkRaw = await readRaw(file);
    if (checkRaw === expectedRaw) {
      await rename(tmp, file);
      return { committed: true };
    }
    await unlink(tmp).catch(() => undefined);
    return { committed: false, raw: checkRaw };
  } catch (err) {
    await unlink(tmp).catch(() => undefined);
    throw err;
  }
}

async function writeUnconditionally(file: string, tmpPrefix: string, content: string): Promise<void> {
  const tmp = tmpPath(file, tmpPrefix);
  try {
    await writeFile(tmp, content, 'utf8');
    await rename(tmp, file);
  } catch (err) {
    await unlink(tmp).catch(() => undefined);
    throw err;
  }
}

function tmpPath(file: string, prefix: string): string {
  return join(dirname(file), `.tmp-${prefix}-${process.pid}-${(seq += 1)}`);
}
