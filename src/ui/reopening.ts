/**
 * The conversations a click is bringing back, while nothing shows yet.
 *
 * Between the click on an ended row and the moment the conversation is alive
 * again — its tab shown, its first hook received — several seconds pass with
 * nothing to look at: `claude-vscode.editor.open` returns as soon as the panel
 * exists, long before the webview has resumed anything, and a terminal resume
 * takes its own time to start. The row said nothing meanwhile, and a second
 * click started a second reopen — the very duplicate tabs the reopen path had
 * just been cleared of. The rows in flight are kept here: the two trees draw
 * a spinner on them and take no click until they are settled.
 *
 * A wait ends when the conversation is open again (`settle`, from the render
 * loop, which is the only place that knows), when the reopen could not even
 * start (`stop`, by the caller — an explanation was shown, or the request
 * failed), or after `wait` ms without either: a resume that never shows up
 * must not leave a spinner turning forever.
 */
export const REOPEN_WAIT_MS = 30_000;

export class Reopening {
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    // Called with the whole set after every change, so the trees can redraw.
    private readonly onChange: (ids: ReadonlySet<string>) => void,
    private readonly wait: number = REOPEN_WAIT_MS,
  ) {}

  ids(): ReadonlySet<string> {
    return new Set(this.timers.keys());
  }

  has(id: string): boolean {
    return this.timers.has(id);
  }

  /** A reopen just started for `id`; a second start restarts its clock. */
  start(id: string): void {
    const previous = this.timers.get(id);
    if (previous !== undefined) clearTimeout(previous);
    this.timers.set(id, setTimeout(() => this.stop(id), this.wait));
    this.onChange(this.ids());
  }

  /** The reopen of `id` is over without the conversation coming back. */
  stop(id: string): void {
    const timer = this.timers.get(id);
    if (timer === undefined) return;
    clearTimeout(timer);
    this.timers.delete(id);
    this.onChange(this.ids());
  }

  /**
   * The conversations open again: their wait is over. One notification for
   * all of them, and none when nothing was waiting — the render loop calls
   * this on every pass.
   */
  settle(open: Iterable<string>): void {
    let changed = false;
    for (const id of open) {
      const timer = this.timers.get(id);
      if (timer === undefined) continue;
      clearTimeout(timer);
      this.timers.delete(id);
      changed = true;
    }
    if (changed) this.onChange(this.ids());
  }

  // No notification: the window is going away, there is nothing to redraw.
  dispose(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }
}
