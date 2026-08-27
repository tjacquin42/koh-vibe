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
