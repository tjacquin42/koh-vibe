/**
 * Delay beyond which a guarded execution is considered stuck rather than
 * merely busy. Calibrated on the worst plausible case observed in real
 * usage: a `SpoolWatcher.tick()` with ~660 pending events. Each event costs
 * at most a few dozen ms even on a slow disk (reading the event, reading
 * then writing or removing the session, removing the event) — on the order
 * of 30 s at worst for 660 events. 60 s leaves a good margin above that
 * estimate, while staying nowhere near the 38 minutes of freeze observed: a
 * tick that exceeds this delay is not just busy, it is stuck.
 *
 * Reused as is for `FocusBroker.tick()` and `render()`: their respective
 * workloads (pending focus requests, displayed sessions) are nowhere near
 * 660 events, so this threshold is very generous there — but nothing would
 * justify a different, untested threshold for each; a freeze there would in
 * any case be caught well before 60 s in real cases, and the same constant
 * everywhere avoids inventing two numbers with no evidence behind them.
 */
export const GUARD_TIMEOUT_MS = 60_000;

/**
 * Reentrancy guard: `run()` only runs `fn` if no previous call is still in
 * flight, and turns any error into a call to `onError` rather than letting
 * it surface as an unhandled rejection.
 *
 * This pattern (check / set / try / catch / finally) used to protect
 * `SpoolWatcher.tick`, `FocusBroker.tick` and `render` as three identical
 * copies: a fix applied to one (e.g. adding the `catch`) could be forgotten
 * in the other two. Has no dependency on `vscode`, so it is testable on its
 * own.
 *
 * `timeoutMs` guards against the other failure, distinct from rejection:
 * `fn` that never settles (neither resolves nor rejects). With no bound,
 * `running` would stay raised forever and every following call would become
 * a silent no-op — a total, silent freeze. Past this delay, the guard
 * releases `running` and signals once; `fn` keeps running in the background
 * (nothing can cancel it), and if it eventually rejects, `onError` still
 * catches it — giving up on waiting must not open an unhandled rejection.
 *
 * A call that arrives after this release runs concurrently with the
 * abandoned execution: accepted, but this is NOT without new risk, contrary
 * to what an earlier version of this comment claimed. I1 (in `drain()`)
 * secures the *read* — re-reading a session's state right before reducing
 * it — not the *write*: nothing prevented an abandoned execution from
 * writing, after the fact, an older state over one a more recent pass had
 * just written. That's why `fn` receives an `AbandonSignal`: the guarded
 * function must check it right before writing anything persistent, and give
 * up if `abandoned` is already true at that moment (see `drain()`, which
 * uses it right before the write-then-remove pair).
 */
export interface AbandonSignal {
  readonly abandoned: boolean;
}

export class ReentrantGuard {
  running = false;

  constructor(private readonly timeoutMs: number) {}

  async run(fn: (signal: AbandonSignal) => Promise<void>, onError: (err: unknown) => void): Promise<void> {
    if (this.running) return;
    this.running = true;

    // Mutable object here; exposed to `fn` via the `AbandonSignal` type
    // (read-only) — the same reference, two views. `run()` flips it on
    // timeout, `fn` can only read it.
    const signal: { abandoned: boolean } = { abandoned: false };
    const execution = fn(signal);
    // Always observed, whether the delay is exceeded or not: without this,
    // an execution abandoned by the timeout that eventually rejects would
    // produce an unhandled rejection — exactly what this same mechanism
    // otherwise prevents.
    const settled = execution.then(
      (): { failed: false } => ({ failed: false }),
      (err: unknown): { failed: true; err: unknown } => ({ failed: true, err }),
    );

    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<'timed-out'>((resolve) => {
      timer = setTimeout(() => resolve('timed-out'), this.timeoutMs);
    });

    const result = await Promise.race([settled, timedOut]);

    if (result === 'timed-out') {
      this.running = false;
      signal.abandoned = true;
      onError(new Error(`ReentrantGuard : délai de ${this.timeoutMs} ms dépassé sans résolution`));
      void settled.then((late) => {
        if (late.failed) onError(late.err);
      });
      return;
    }

    if (timer !== undefined) clearTimeout(timer);
    this.running = false;
    if (result.failed) onError(result.err);
  }
}
