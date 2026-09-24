import { watch, type FSWatcher } from 'node:fs';
import { readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { SpoolDirs } from '../paths';
import type { LocalEvent, Session, SpoolEvent } from '../events/types';
import { parseSpoolFile } from '../events/parse';
import { reduce } from '../store/reduce';
import { capEndedSessions, ensureDirs, readSession, removeSession, writeSession } from './persist';
import { MAX_ENDED } from '../store/open';
import { type AbandonSignal, GUARD_TIMEOUT_MS, ReentrantGuard } from '../lib/reentrant-guard';
import { isErrnoException } from '../lib/errno';

export interface DrainResult {
  applied: number;
  rejected: number;
  /** Processed but not written (an I/O failure external to the event): left
   * in place in events/ for a future drain, neither lost nor classed as
   * invalid — unless it has exceeded MAX_EVENT_AGE_MS, see
   * `rejectedPermanently`. */
  deferred: number;
  /** Names of the events discarded to rejected/ for having failed while
   * already past MAX_EVENT_AGE_MS (N3): a subset of what counts in
   * `rejected`, singled out so the caller can report the abandonment
   * rather than leave it invisible. */
  rejectedPermanently: string[];
  /**
   * The tool calls this pass saw, reduced to what the process view needs: the
   * command and the agent behind it, if any.
   *
   * Carried out of the drain rather than read again from the spool, because
   * there is nowhere to read it from — the files are gone by then, and the
   * session state the events reduce to has no room for something this
   * short-lived. See process/agents.ts.
   */
  toolCalls: SpoolEvent[];
}

/**
 * Archives a conversation that has just ended, before its state file is
 * deleted. Injected rather than imported: `drain` knows the spool, not the
 * shared files that sit next to it — and the tests that do not care about
 * archiving keep calling `drain` without it.
 */
export type ArchiveClosed = (s: Session) => Promise<void>;

/**
 * What `SessionEnd` does to the row: `'keep'` marks it ended and leaves it in
 * the list, greyed out; `'remove'` takes it away, as closing the tab used to.
 * The user's "persistent sessions" setting, read by the watcher at every pass.
 */
export type EndPolicy = 'keep' | 'remove';

/**
 * Past this age, an event that still fails is no longer considered
 * transient: it is moved to rejected/ with its reason instead of being
 * retried indefinitely in silence (N3). The age is read from the event's
 * own file name (the timestamp that opens it, already used for processing
 * order) — not from an in-memory retry counter: the latter confused
 * "failing for 2 ms, 3 times in a row" (under a burst of hundreds of
 * events, a counter exhausts its attempts within a few real milliseconds)
 * with "failing for a long time", depended on per-window state (never
 * shared, reset on every reopening), and gave a different result depending
 * on which window was counting. A duration has none of these flaws: the
 * same for every window, independent of load, indifferent to a window
 * closing.
 *
 * 5 minutes: very generous compared to the time of a tick, even under load
 * (~30 s worst case for ~660 events, see GUARD_TIMEOUT_MS) — an event that
 * still fails after 5 minutes has already survived dozens of passes, not
 * just a load spike.
 */
export const MAX_EVENT_AGE_MS = 5 * 60_000;

/**
 * The timestamp that opens an event's file name (bridge:
 * `<at>-<pid>-<event>.json`; appendLocalEvent: `<at>-<pid>-<seq>-<event>.json`),
 * in epoch milliseconds. `undefined` for a name that does not start with a
 * number — should not happen for a file actually dropped by this project,
 * but being unable to date an event must never be read as "therefore it
 * is old": see the caller.
 */
function eventTimestamp(name: string): number | undefined {
  const stamp = name.split('-', 1)[0];
  const at = stamp === undefined || stamp.length === 0 ? NaN : Number(stamp);
  return Number.isFinite(at) ? at : undefined;
}

/**
 * Consumes the whole spool once. Nothing here removes a session for
 * staying quiet: a tab left open for a whole day is still a conversation.
 * Only the user, closing or removing it, takes it off the list — and
 * `SessionEnd` when `endPolicy` is `'remove'` (the « persistent sessions »
 * setting unchecked); otherwise the ended conversation stays, marked
 * `endedAt`.
 *
 * The order matters: the state is written BEFORE the event is deleted.
 * Another window that misses the deleted event still finds the state in
 * sessions/; the reverse order would leave a hole.
 *
 * Each event re-reads the state of ITS session right before reducing it —
 * never a snapshot of the whole map held across several `await`s: another
 * window can write or delete this very session between two iterations of
 * this loop, and reducing must always happen against the most recent
 * state, not against what was true at the very start of this drain.
 *
 * `signal` (supplied by `ReentrantGuard.run()`, absent when `drain` is
 * called outside a guard) protects against a flaw I1 does not cover: I1
 * re-reads a session's state right before REDUCING it, which protects the
 * read, not the write that follows. An execution abandoned by the guard
 * (it exceeded its timeout, but keeps running in the background) may have
 * reduced a state from a now-stale read; if it still writes, it overwrites
 * a more recent state written in the meantime by a fresh pass.
 * `signal.abandoned` is therefore checked right before EACH
 * write-then-delete pair, never before: the invariant "the state is
 * written before the event is deleted" is what makes this abandonment
 * lossless — the event, neither applied nor deleted, will be reprocessed
 * by the fresh pass.
 */
export async function drain(
  dirs: SpoolDirs,
  now: number,
  signal?: AbandonSignal,
  archive?: ArchiveClosed,
  endPolicy: EndPolicy = 'keep',
  // Whether a conversation ever got a message. One that ends without a
  // transcript never was one — Claude Code starts such a session for every
  // panel it opens, and drops it moments later — so its row goes, whatever
  // the policy, and the history never hears of it. Absent, every end counts.
  hasTranscript?: (s: Session) => Promise<boolean>,
): Promise<DrainResult> {
  let names: string[] = [];
  try {
    names = await readdir(dirs.events);
  } catch {
    // The spool has disappeared (e.g. `rm -rf ~/.koh-vibe` while the
    // extension is running): recreate it rather than staying silent until
    // the next window reload — ensureDirs is idempotent, safe to call
    // again here. The bridge, which exits silently when `events/` does not
    // exist (guarded by `[[ -d "$DIR" ]]`), then drops normally again at
    // the next hook.
    await ensureDirs(dirs).catch(() => undefined);
    names = [];
  }

  // The name starts with the timestamp: lexicographic sort follows time.
  const files = names.filter((n) => n.endsWith('.json') && !n.startsWith('.')).sort();
  let applied = 0;
  let rejected = 0;
  let deferred = 0;
  let endedOne = false;
  const rejectedPermanently: string[] = [];
  // Collected as they go by, for the process view's agent index: the files
  // are unlinked moments later, so this pass is the only chance to see them.
  const toolCalls: SpoolEvent[] = [];

  for (const name of files) {
    const path = join(dirs.events, name);
    let raw: string;
    try {
      raw = await readFile(path, 'utf8');
    } catch {
      continue; // consumed by another window between the readdir and the readFile
    }

    const ev = parseSpoolFile(raw);
    if (ev === undefined) {
      rejected += 1;
      await rename(path, join(dirs.rejected, name)).catch(() => undefined);
      continue;
    }

    try {
      const current = await readSession(dirs, ev.sessionId);
      const next = reduce(current, ev);

      if (signal?.abandoned) {
        // This execution was abandoned (guard timeout exceeded) while it
        // was still holding this now-stale read: writing `next` now would
        // overwrite a more recent state written by the fresh pass already
        // running. We stop here, before writing anything at all — the
        // event stays in place, neither applied nor deleted, and will be
        // reprocessed. Nothing else can safely be done by this execution
        // any more: we stop the whole drain, not just this event.
        return { applied, rejected, deferred, rejectedPermanently, toolCalls };
      }

      // Archive BEFORE writing, for the same reason the state is written
      // before the event is removed: whatever fails here leaves the event in
      // place (it comes back through `deferred`, below), so nothing is lost.
      //
      // `SessionEnd` only: it is the one event that means "this conversation
      // is over". Archived under both policies: the history is what the
      // "Recently closed" view shows once the setting is turned off.
      const ended = ev.event === 'SessionEnd';
      const blank = ended && current !== undefined && hasTranscript !== undefined && !(await hasTranscript(current));
      if (ended && current !== undefined && archive !== undefined && !blank) {
        await archive(current);
      }
      // Asked again, and this is the look that counts: `hasTranscript` and
      // `archive` are two more awaits on the way to the write, for an end
      // only, and an execution abandoned during either reached the write
      // with the reading above gone stale — putting the conversation back to
      // ended over the prompt that had just woken it.
      if (signal?.abandoned) {
        return { applied, rejected, deferred, rejectedPermanently, toolCalls };
      }
      if (next === undefined || blank || (ended && endPolicy === 'remove')) {
        // `'remove'` takes the end at face value, late or not: the policy is
        // "closing the tab takes the row away", and that is what it does.
        await removeSession(dirs, ev.sessionId);
      } else {
        await writeSession(dirs, next);
        if (ended) endedOne = true;
      }
    } catch (err) {
      // A failure external to this specific event (disk full, sessions/
      // not writable, read-only volume). Without this `continue`, the
      // exception would propagate and stop the loop: the following
      // events, even though unrelated to this failure, would stay
      // unprocessed — and since the sort is chronological, the first
      // faulty file would block every one after it, on every drain, in
      // every window.
      const createdAt = eventTimestamp(name);
      const age = createdAt !== undefined ? now - createdAt : undefined;
      if (age !== undefined && age > MAX_EVENT_AGE_MS) {
        // Still failing even though it is already older than what a
        // transient failure would justify: we stop retrying it
        // indefinitely in silence, and discard it — visibly, with its
        // reason — rather than lose it.
        rejected += 1;
        rejectedPermanently.push(name);
        const reason = `Échec à ${age} ms d'âge (> ${MAX_EVENT_AGE_MS} ms) : ${err instanceof Error ? err.message : String(err)}`;
        await writeFile(join(dirs.rejected, `${name}.reason.txt`), reason, 'utf8').catch(() => undefined);
        await rename(path, join(dirs.rejected, name)).catch(() => undefined);
      } else {
        // Neither its effects nor the deletion of its file happened. We
        // leave it in place so that a future drain — in this window or
        // another — retries it, rather than lose it or classify it as
        // invalid data (it is not, yet).
        deferred += 1;
      }
      continue;
    }

    applied += 1;
    // Only the calls that leave a process behind, and only once applied:
    // an event that failed to reduce will be retried, and counting it here
    // would claim a command twice.
    if (ev.toolName === 'Bash') toolCalls.push(ev);
    try {
      await unlink(path);
    } catch (err) {
      if (isErrnoException(err) && err.code === 'ENOENT') {
        // already deleted by another window: benign, the state is already written
      } else {
        // a real failure (permission, disk full…): leaving the file in
        // place would make it get reapplied on the next drain, and for a
        // cumulative effect like PostToolUse that would corrupt the
        // state. We discard it instead, like an unreadable file.
        rejected += 1;
        await rename(path, join(dirs.rejected, name)).catch(() => undefined);
      }
    }
  }

  // Ended conversations are kept, up to a point: past MAX_ENDED the oldest
  // goes. Only worth a look when this pass ended one.
  if (endedOne) await capEndedSessions(dirs, MAX_ENDED);

  return { applied, rejected, deferred, rejectedPermanently, toolCalls };
}

export interface LocalEventInput {
  event: LocalEvent;
  sessionId: string;
  cwd: string;
}

// `appendLocalEvent` runs in the extension's long-lived process: unlike the
// bridge, where a process equals a call, `process.pid` is not unique per
// call there. A counter incremented synchronously on every call is, even
// for concurrent calls with no `await` between them.
let localEventSeq = 0;

// A process id that is not zero-padded sorts poorly lexicographically
// within the same millisecond (`"9" > "1"`, even though 9 < 10): two
// events dropped in the same millisecond by processes with ids of
// different widths can then get applied in the wrong order. A fixed
// padding, wide enough to never be reached by a real pid, closes this
// ambiguity for good.
const PID_WIDTH = 10;
function pad(pid: number): string {
  return String(pid).padStart(PID_WIDTH, '0');
}

/** Drops a user action into the same spool as the hooks. */
export async function appendLocalEvent(dirs: SpoolDirs, input: LocalEventInput): Promise<void> {
  const at = Date.now();
  const seq = (localEventSeq += 1);
  const pid = pad(process.pid);
  const body = JSON.stringify({
    event: input.event,
    at,
    entrypoint: 'claude-vscode',
    termProgram: 'vscode',
    payload: { session_id: input.sessionId, cwd: input.cwd },
  });
  const name = `${at}-${pid}-${seq}-${input.event}.json`;
  const tmp = join(dirs.events, `.tmp-${pid}-${seq}-${input.event}`);
  await writeFile(tmp, body, 'utf8');
  await rename(tmp, join(dirs.events, name));
}

/** Watches the spool and calls `onChange` after every drain that did something. */
export class SpoolWatcher {
  private watcher: FSWatcher | undefined;
  private timer: NodeJS.Timeout | undefined;
  private readonly guard = new ReentrantGuard(GUARD_TIMEOUT_MS);

  constructor(
    private readonly dirs: SpoolDirs,
    private readonly onChange: (result: DrainResult) => void,
    private readonly onError: (err: unknown) => void,
    // Injectable clock: a test dates its events with small integers
    // without depending on the real Date.now(). The extension's
    // long-lived process keeps the default behavior.
    private readonly now: () => number = Date.now,
    // Required: this is the only production path into `drain`, so it is the
    // only place where forgetting it must be a compile error rather than a
    // silently empty history.
    private readonly archive: ArchiveClosed,
    // Read at every pass, never captured: the setting is a shared file the
    // user can flip at any time, in any window.
    private readonly endPolicy: () => EndPolicy,
    private readonly hasTranscript: (s: Session) => Promise<boolean>,
  ) {}

  start(): void {
    void this.tick();
    try {
      this.watcher = watch(this.dirs.events, () => this.schedule());
    } catch {
      // The folder does not exist yet (e.g. first open before any hook).
      // drain() already tolerates its absence; the 5s safety net below is
      // enough to take over as soon as it appears.
      this.watcher = undefined;
    }
    // Safety net: fs.watch can miss events on some volumes.
    this.timer = setInterval(() => this.schedule(), 5_000);
  }

  stop(): void {
    this.watcher?.close();
    this.watcher = undefined;
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
  }

  private schedule(): void {
    void this.tick();
  }

  private tick(): Promise<void> {
    return this.guard.run(async (signal) => {
      const res = await drain(this.dirs, this.now(), signal, this.archive, this.endPolicy(), this.hasTranscript);
      if (res.rejectedPermanently.length > 0) {
        // Dedicated reporting: drain() did not fail (the other events
        // applied normally), but this one failed while already too old
        // for it to still be transient — it must not disappear in
        // silence.
        this.onError(
          new Error(
            `${res.rejectedPermanently.length} événement(s) écarté(s) définitivement (échec persistant au-delà de ${MAX_EVENT_AGE_MS} ms)`,
          ),
        );
      }
      if (res.applied > 0) this.onChange(res);
    }, this.onError);
  }
}
