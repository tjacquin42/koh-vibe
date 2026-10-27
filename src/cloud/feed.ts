import { rename, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { isRecord } from '../lib/json';
import { readRaw } from '../lib/shared-file';

/**
 * A list read from claude.ai, cached in a file every window shares.
 *
 * The usage reading's contract (usage/reader.ts), generalised to the two cloud
 * views: ask at most every FEED_REFRESH_AFTER_MS; count the attempts rather
 * than the successes, so a failure costs as little as a success; let a window
 * reuse what another one just read; keep showing the last list — with its age
 * — when a later read fails.
 *
 * Two differences, for the tests as much as for the code: the date of the
 * reading is written INSIDE the file, so an injected clock drives everything
 * (a file's mtime cannot be); and the pacing belongs to the instance, so each
 * test starts from a fresh one instead of resetting a module-level table.
 */

/** What one request brought back. */
export type Fetched<T> =
  | { kind: 'ok'; items: T[]; truncated: boolean }
  /** No token, or no claude.ai account behind it: asking again will not help until someone signs in. */
  | { kind: 'signed-out' }
  /** The network, the status, or a shape we do not know: worth asking again later. */
  | { kind: 'unavailable' };

/** A list as cached: when it was read, and whether the server said there was more. */
export interface Snapshot<T> {
  at: number;
  items: T[];
  truncated: boolean;
}

/** What a view has to show. */
export type FeedView<T> =
  | { kind: 'loading' }
  | { kind: 'signed-out' }
  | { kind: 'unavailable' }
  | { kind: 'ready'; snapshot: Snapshot<T> };

export const FEED_REFRESH_AFTER_MS = 5 * 60_000;

/** Bumped whenever the shape of the items changes: an older file is then ignored, never misread. */
const CACHE_VERSION = 1;

export interface FeedDeps<T> {
  fetch: () => Promise<Fetched<T>>;
  now: () => number;
}

export class Feed<T> {
  private lastAttempt: number | undefined;
  private lastFailure: 'signed-out' | 'unavailable' | undefined;
  // What this window read last, kept in case the file could not be written:
  // the view still shows it; only the other windows miss it.
  private memory: Snapshot<T> | undefined;
  private inFlight: Promise<void> | undefined;

  constructor(
    private readonly file: string,
    private readonly isItem: (v: unknown) => v is T,
    private readonly deps: FeedDeps<T>,
  ) {}

  /**
   * Asks claude.ai again when the list is old enough, or right away when
   * `force` — the refresh button, or the re-read after an action. Never
   * throws, and sends one request at a time per window: an ordinary refresh
   * has nothing to add to one already running; a forced one waits for it,
   * then asks for its own answer.
   */
  async refresh(force: boolean): Promise<void> {
    if (this.inFlight !== undefined) {
      if (!force) return this.inFlight;
      await this.inFlight;
    }
    const attempt = this.attempt(force);
    this.inFlight = attempt;
    try {
      await attempt;
    } finally {
      if (this.inFlight === attempt) this.inFlight = undefined;
    }
  }

  /** The freshest list this window knows of, or why there is none. */
  async read(): Promise<FeedView<T>> {
    const snapshot = this.newest(await this.cached());
    if (snapshot !== undefined) return { kind: 'ready', snapshot };
    if (this.lastFailure === 'signed-out') return { kind: 'signed-out' };
    if (this.lastFailure === 'unavailable') return { kind: 'unavailable' };
    return { kind: 'loading' };
  }

  private async attempt(force: boolean): Promise<void> {
    const now = this.deps.now();
    if (!force) {
      if (this.lastAttempt !== undefined && now - this.lastAttempt < FEED_REFRESH_AFTER_MS) return;
      // Another window may have just read it for us: the file is shared.
      const known = this.newest(await this.cached());
      if (known !== undefined && now - known.at < FEED_REFRESH_AFTER_MS) return;
    }
    this.lastAttempt = now;
    let fetched: Fetched<T>;
    try {
      fetched = await this.deps.fetch();
    } catch {
      fetched = { kind: 'unavailable' };
    }
    if (fetched.kind !== 'ok') {
      this.lastFailure = fetched.kind;
      return;
    }
    this.lastFailure = undefined;
    const snapshot: Snapshot<T> = { at: this.deps.now(), items: fetched.items, truncated: fetched.truncated };
    this.memory = snapshot;
    await this.write(snapshot);
  }

  private newest(fromFile: Snapshot<T> | undefined): Snapshot<T> | undefined {
    if (fromFile === undefined) return this.memory;
    if (this.memory === undefined) return fromFile;
    return fromFile.at >= this.memory.at ? fromFile : this.memory;
  }

  private async cached(): Promise<Snapshot<T> | undefined> {
    const raw = await readRaw(this.file);
    if (raw === undefined) return undefined;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return undefined;
    }
    if (!isRecord(parsed) || parsed['version'] !== CACHE_VERSION) return undefined;
    const at = parsed['at'];
    const items = parsed['items'];
    if (typeof at !== 'number' || !Number.isFinite(at) || !Array.isArray(items)) return undefined;
    const list: unknown[] = items;
    return { at, truncated: parsed['truncated'] === true, items: list.filter((v): v is T => this.isItem(v)) };
  }

  /** Atomic, like every shared file here: another window may be reading while we write. */
  private async write(snapshot: Snapshot<T>): Promise<void> {
    const tmp = join(dirname(this.file), `.tmp-${basename(this.file)}-${process.pid}`);
    try {
      await writeFile(tmp, JSON.stringify({ version: CACHE_VERSION, ...snapshot }), 'utf8');
      await rename(tmp, this.file);
    } catch {
      await unlink(tmp).catch(() => undefined);
    }
  }
}
