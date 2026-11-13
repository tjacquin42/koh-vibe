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
 * Keeps every open view on the same snapshot.
 *
 * Builds are serialised and coalesced: while one is running, any number of
 * change notifications collapse into a single rebuild after it. Without this,
 * a burst of file events would run overlapping reads and could post an older
 * snapshot after a newer one.
 */
export class Hub implements Disposable {
  /** Each client, and whether it has had its `init` yet. */
  private readonly clients = new Map<Client, boolean>();
  private latest: Snapshot | undefined;
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

  private send(client: Client, snap: Snapshot): void {
    if (this.clients.get(client) === true) {
      client.post({ type: 'snapshot', snapshot: snap });
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
        this.latest = snap;
        for (const c of [...this.clients.keys()]) this.send(c, snap);
      } catch (err) {
        this.deps.log(`snapshot failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    } while (this.again && !this.disposed);
  }

  dispose(): void {
    this.disposed = true;
    this.watcher.dispose();
    this.clients.clear();
  }
}
