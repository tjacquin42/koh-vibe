import type { HostMessage, Snapshot, ViewContext } from '../shared/protocol';
import type { Disposable } from './watch';

/** One open web view, as the hub sees it: somewhere to post, and what it renders. */
export interface Client {
  context: ViewContext;
  post(message: HostMessage): void;
}

export interface HubDeps {
  build(): Promise<Snapshot>;
  watch(onChange: () => void): Disposable;
  /** Where build failures go: the view keeps its last good snapshot. */
  log(message: string): void;
}

/**
 * What a snapshot says, but for the moments its parts were read at: two
 * builds that read the same thing compare equal. No view shows those moments.
 */
export function contentKey(snap: Snapshot): string {
  return JSON.stringify({
    ...snap,
    at: 0,
    ...(snap.activity === undefined ? {} : { activity: { ...snap.activity, at: 0, since: 0 } }),
    ...(snap.processes === undefined ? {} : { processes: { ...snap.processes, at: 0 } }),
    ...(snap.sheet === undefined ? {} : { sheet: { ...snap.sheet, since: 0 } }),
  });
}

/**
 * Keeps every open view on the same snapshot.
 *
 * A build that found nothing new is not sent again (16/11): the watcher's
 * slow timer rebuilds every few seconds, and a whole list posted to every
 * view each time made each of them draw itself again for nothing. The views
 * are only told a build ended (`steady`) — a row waiting for « the next
 * snapshot » to stop spinning must still hear of it.
 *
 * Builds are serialised and coalesced: while one is running, any number of
 * change notifications collapse into a single rebuild after it. Without this,
 * a burst of file events would run overlapping reads and could post an older
 * snapshot after a newer one.
 */
export class Hub implements Disposable {
  /** Each client, and whether it has had its `init` yet. */
  private readonly clients = new Map<Client, boolean>();
  private readonly listeners = new Set<(snap: Snapshot) => void>();
  private latest: Snapshot | undefined;
  /** What `latest` says, but for the moment it was built: two builds that read the same thing compare equal. */
  private latestKey: string | undefined;
  private running: Promise<void> | undefined;
  private again = false;
  private readonly watcher: Disposable;
  private disposed = false;

  constructor(private readonly deps: HubDeps) {
    this.watcher = deps.watch(() => void this.refresh());
  }

  /** The snapshot views last received, if any build succeeded. */
  get current(): Snapshot | undefined {
    return this.latest;
  }

  /**
   * Registers a view that has said it is ready. Its first message is always
   * `init` (context and snapshot together), so the view never holds data it
   * has no context to render against; plain `snapshot`s follow.
   */
  async attach(client: Client): Promise<Disposable> {
    this.clients.set(client, false);
    if (this.latest === undefined) await this.refresh();
    else this.send(client, this.latest);
    return { dispose: () => this.clients.delete(client) };
  }

  /** Called after every successful build — the status bar listens here. */
  subscribe(listener: (snap: Snapshot) => void): Disposable {
    this.listeners.add(listener);
    if (this.latest !== undefined) listener(this.latest);
    return { dispose: () => this.listeners.delete(listener) };
  }

  refresh(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    if (this.running !== undefined) {
      this.again = true;
      return this.running;
    }
    this.running = this.loop().finally(() => {
      this.running = undefined;
    });
    return this.running;
  }

  private send(client: Client, snap: Snapshot, same = false): void {
    if (this.clients.get(client) === true) {
      client.post(same ? { type: 'steady' } : { type: 'snapshot', snapshot: snap });
    } else {
      this.clients.set(client, true);
      client.post({ type: 'init', context: client.context, snapshot: snap });
    }
  }

  private async loop(): Promise<void> {
    do {
      this.again = false;
      try {
        const snap = await this.deps.build();
        if (this.disposed) return;
        const key = contentKey(snap);
        const same = key === this.latestKey;
        this.latest = snap;
        this.latestKey = key;
        for (const c of [...this.clients.keys()]) this.send(c, snap, same);
        if (!same) for (const l of [...this.listeners]) l(snap);
      } catch (err) {
        this.deps.log(`snapshot failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    } while (this.again && !this.disposed);
  }

  dispose(): void {
    this.disposed = true;
    this.watcher.dispose();
    this.clients.clear();
    this.listeners.clear();
  }
}
