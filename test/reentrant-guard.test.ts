import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReentrantGuard } from '../src/lib/reentrant-guard';

// A delay clearly larger than any normal test (which settles within a few
// microtasks): the timeout branch must never trigger in those tests — only
// the ones that explicitly target it advance the fake clock that far.
const NEVER_TIMES_OUT_MS = 1_000_000;

describe('ReentrantGuard', () => {
  it('ignores a trigger while a call is already in flight', async () => {
    const guard = new ReentrantGuard(NEVER_TIMES_OUT_MS);
    let inFlight = false;
    let concurrentCalls = 0;
    const onError = () => undefined;

    const first = guard.run(async () => {
      inFlight = true;
      // A second run() triggered while the first is in flight must be a no-op.
      await guard.run(async () => {
        concurrentCalls += 1;
      }, onError);
      await Promise.resolve();
      inFlight = false;
    }, onError);

    expect(inFlight).toBe(true);
    await first;

    expect(concurrentCalls).toBe(0);
    expect(guard.running).toBe(false);
  });

  it('runs normally when no call is in flight', async () => {
    const guard = new ReentrantGuard(NEVER_TIMES_OUT_MS);
    let calls = 0;
    await guard.run(async () => {
      calls += 1;
    }, () => undefined);
    expect(calls).toBe(1);
    expect(guard.running).toBe(false);
  });

  it('falls back to running=false after a run, allowing the next call', async () => {
    const guard = new ReentrantGuard(NEVER_TIMES_OUT_MS);
    let calls = 0;
    await guard.run(async () => {
      calls += 1;
    }, () => undefined);
    await guard.run(async () => {
      calls += 1;
    }, () => undefined);
    expect(calls).toBe(2);
  });

  it('swallows an error via onError rather than letting it surface as an unhandled rejection', async () => {
    const guard = new ReentrantGuard(NEVER_TIMES_OUT_MS);
    const errors: unknown[] = [];
    const boom = new Error('panne');

    await expect(
      guard.run(async () => {
        throw boom;
      }, (err) => errors.push(err)),
    ).resolves.toBeUndefined();

    expect(errors).toEqual([boom]);
  });

  it('resets running to false after an error: the next call is not blocked', async () => {
    const guard = new ReentrantGuard(NEVER_TIMES_OUT_MS);
    await guard.run(async () => {
      throw new Error('panne');
    }, () => undefined);

    expect(guard.running).toBe(false);

    let ranAfter = false;
    await guard.run(async () => {
      ranAfter = true;
    }, () => undefined);
    expect(ranAfter).toBe(true);
  });

  it('a trigger during an in-flight run does not lose the work: replayable afterwards', async () => {
    const guard = new ReentrantGuard(NEVER_TIMES_OUT_MS);
    const done: string[] = [];

    let releaseFirst: () => void = () => undefined;
    const blocker = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = guard.run(async () => {
      await blocker;
      done.push('premier');
    }, () => undefined);

    // The second is an immediate no-op while the first is in flight.
    await guard.run(async () => {
      done.push('second');
    }, () => undefined);
    expect(done).toEqual([]);

    releaseFirst();
    await first;
    expect(done).toEqual(['premier']);

    // A new call after the first one ends runs normally.
    await guard.run(async () => {
      done.push('troisième');
    }, () => undefined);
    expect(done).toEqual(['premier', 'troisième']);
  });

  describe('bounded in time (N2)', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it('releases the guard and reports once if fn never settles before the delay', async () => {
      vi.useFakeTimers();
      const guard = new ReentrantGuard(1000);
      const errors: unknown[] = [];

      // Never settles (neither resolves nor rejects): simulates a stuck tick.
      const runPromise = guard.run(() => new Promise<void>(() => undefined), (err) => errors.push(err));

      await vi.advanceTimersByTimeAsync(999);
      expect(guard.running).toBe(true);
      expect(errors).toHaveLength(0);

      await vi.advanceTimersByTimeAsync(2);
      await runPromise;

      expect(guard.running).toBe(false);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toBeInstanceOf(Error);
    });

    it("passes fn a signal whose abandoned becomes true at the moment the delay is exceeded, not before", async () => {
      vi.useFakeTimers();
      const guard = new ReentrantGuard(1000);
      const observedBeforeTimeout: boolean[] = [];
      let observedAfterTimeout: boolean | undefined;

      const runPromise = guard.run(async (signal) => {
        observedBeforeTimeout.push(signal.abandoned);
        await new Promise<void>((resolve) => {
          setTimeout(() => {
            observedAfterTimeout = signal.abandoned;
            resolve();
          }, 5000); // well past the guard's delay: fn keeps running in the background
        });
      }, () => undefined);

      await vi.advanceTimersByTimeAsync(1000);
      expect(guard.running).toBe(false);
      expect(observedBeforeTimeout).toEqual([false]); // not yet abandoned when fn started

      await vi.advanceTimersByTimeAsync(4000);
      await runPromise;

      expect(observedAfterTimeout).toBe(true); // the same signal reference reflects the abandonment afterwards
    });

    it('two concurrent passes after a delay is exceeded: accepted, like two windows draining at the same time', async () => {
      vi.useFakeTimers();
      const guard = new ReentrantGuard(1000);
      const order: string[] = [];

      void guard.run(() => new Promise<void>(() => undefined), () => undefined);
      await vi.advanceTimersByTimeAsync(1000);
      expect(guard.running).toBe(false);

      // The guard no longer blocks: a new call runs while the first
      // (abandoned, never cancelled) is still virtually in flight.
      await guard.run(async () => {
        order.push('second appel, après le délai du premier');
      }, () => undefined);

      expect(order).toEqual(['second appel, après le délai du premier']);
    });

    it("the abandoned run that ends up rejecting later is not an unhandled rejection: onError catches it too", async () => {
      vi.useFakeTimers();
      const guard = new ReentrantGuard(1000);
      const errors: unknown[] = [];
      const lateBoom = new Error('panne tardive');

      let rejectLate: (err: unknown) => void = () => undefined;
      const neverSoon = new Promise<void>((_resolve, reject) => {
        rejectLate = reject;
      });

      const runPromise = guard.run(() => neverSoon, (err) => errors.push(err));
      await vi.advanceTimersByTimeAsync(1000);
      await runPromise;

      expect(errors).toEqual([expect.any(Error)]); // the report of the exceeded delay

      rejectLate(lateBoom);
      // Lets the .then attached to the abandoned run settle.
      await vi.advanceTimersByTimeAsync(0);
      await Promise.resolve();

      expect(errors).toContain(lateBoom);
      expect(errors).toHaveLength(2);
    });

    it("the abandoned run that ends up succeeding later does not trigger a second report", async () => {
      vi.useFakeTimers();
      const guard = new ReentrantGuard(1000);
      const errors: unknown[] = [];

      let resolveLate: () => void = () => undefined;
      const neverSoon = new Promise<void>((resolve) => {
        resolveLate = resolve;
      });

      const runPromise = guard.run(() => neverSoon, (err) => errors.push(err));
      await vi.advanceTimersByTimeAsync(1000);
      await runPromise;
      expect(errors).toHaveLength(1); // the report of the exceeded delay

      resolveLate();
      await vi.advanceTimersByTimeAsync(0);
      await Promise.resolve();

      expect(errors).toHaveLength(1); // still just one, the late success reports nothing
    });

    it('does not trigger the delay when fn settles well before it', async () => {
      vi.useFakeTimers();
      const guard = new ReentrantGuard(1000);
      const errors: unknown[] = [];
      let calls = 0;

      await guard.run(async () => {
        calls += 1;
      }, (err) => errors.push(err));

      await vi.advanceTimersByTimeAsync(1000);

      expect(calls).toBe(1);
      expect(errors).toHaveLength(0);
      expect(guard.running).toBe(false);
    });
  });
});
