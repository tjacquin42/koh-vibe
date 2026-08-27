import { describe, expect, it } from 'vitest';
import { showBusy } from '../src/ui/busy';

/**
 * Records what the indicator does around a task: the flag it raises and
 * lowers (the spinning icon in place of the Refresh button), and the progress
 * indication it runs the task inside (the bar under the view's title).
 */
function recorder() {
  const log: string[] = [];
  return {
    log,
    deps: {
      setBusy: async (busy: boolean): Promise<void> => {
        log.push(busy ? 'busy' : 'idle');
      },
      progress: async <T,>(task: () => Promise<T>): Promise<T> => {
        log.push('progress:start');
        const result = await task();
        log.push('progress:end');
        return result;
      },
    },
  };
}

describe('showBusy', () => {
  it('raises the flag before the task, runs it inside the progress indication, and lowers it after', async () => {
    const { log, deps } = recorder();
    const result = await showBusy(async () => {
      log.push('task');
      return 42;
    }, deps);
    expect(result).toBe(42);
    expect(log).toEqual(['busy', 'progress:start', 'task', 'progress:end', 'idle']);
  });

  it('lowers the flag even when the task fails, and lets the failure through', async () => {
    const { log, deps } = recorder();
    await expect(
      showBusy(async () => {
        throw new Error('registry unreadable');
      }, deps),
    ).rejects.toThrow('registry unreadable');
    expect(log.at(-1)).toBe('idle');
  });

  it('does not let a failing flag hide the task result', async () => {
    const { deps } = recorder();
    const flaky = { ...deps, setBusy: async (): Promise<void> => { throw new Error('no context'); } };
    expect(await showBusy(async () => 'done', flaky)).toBe('done');
  });
});

describe('showBusy — minimum duration', () => {
  it('keeps the indicator up for at least MIN_BUSY_MS, even when the task is instant', async () => {
    // A rescan that finds everything already in place takes a few
    // milliseconds: without a floor, the spinner is a flicker nobody sees, and
    // Refresh looks like it did nothing.
    const { log, deps } = recorder();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const waited: number[] = [];
    const p = showBusy(async () => 'fast', {
      ...deps,
      minMs: 600,
      wait: (ms: number) => {
        waited.push(ms);
        return gate;
      },
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(log).toContain('busy');
    expect(log).not.toContain('idle');
    release();
    expect(await p).toBe('fast');
    expect(waited).toEqual([600]);
    expect(log.at(-1)).toBe('idle');
  });

  it('does not add the floor on top of a task that already took longer', async () => {
    const { deps } = recorder();
    const waited: number[] = [];
    let clock = 0;
    await showBusy(
      async () => {
        clock += 1_000;
        return 'slow';
      },
      { ...deps, minMs: 600, now: () => clock, wait: async (ms: number) => { waited.push(ms); } },
    );
    expect(waited).toEqual([]);
  });
});
