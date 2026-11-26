import { watch, type FSWatcher } from 'node:fs';
import { sep } from 'node:path';

export interface Disposable {
  dispose(): void;
}

export interface WatchOptions {
  /** Quiet time before a burst of changes triggers one rebuild. */
  debounceMs?: number;
  /**
   * A rebuild on a timer as well. `fs.watch` can miss changes (a directory
   * recreated under it, a network volume) and says nothing when it does; the
   * poll caps how stale the view can get.
   */
  pollMs?: number;
}

/**
 * The spool (`events/`) churns with every hook and means nothing to the view
 * until V1 drains it into `sessions/` — which is watched. Temporary files are
 * the other half of an atomic write; the rename that follows is what counts.
 */
export function isRelevant(relative: string | null): boolean {
  if (relative === null) return true;
  const first = relative.split(sep)[0] ?? '';
  if (first === 'events' || first === 'backups') return false;
  const base = relative.split(sep).pop() ?? '';
  return !base.startsWith('.tmp-');
}

/**
 * Calls `onChange` after koh-vibe's state changes, debounced, plus on a slow
 * timer. Never throws: a home that does not exist yet just means no events
 * until the poll finds it.
 */
export function watchHome(home: string, onChange: () => void, opts: WatchOptions = {}): Disposable {
  const debounceMs = opts.debounceMs ?? 120;
  const pollMs = opts.pollMs ?? 5_000;
  let timer: NodeJS.Timeout | undefined;
  const fire = (): void => {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      onChange();
    }, debounceMs);
  };
  let watcher: FSWatcher | undefined;
  try {
    watcher = watch(home, { recursive: true }, (_event, name) => {
      if (isRelevant(name === null ? null : name.toString())) fire();
    });
    watcher.on('error', () => {
      watcher?.close();
      watcher = undefined;
    });
  } catch {
    watcher = undefined;
  }
  const poll = setInterval(onChange, pollMs);
  return {
    dispose(): void {
      if (timer !== undefined) clearTimeout(timer);
      clearInterval(poll);
      watcher?.close();
    },
  };
}
