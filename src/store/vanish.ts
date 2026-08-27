/** The ids that were in `previous` and are not in `next`. */
export function vanishedIds(previous: ReadonlySet<string>, next: Iterable<string>): string[] {
  const now = new Set(next);
  return [...previous].filter((id) => !now.has(id));
}

/**
 * Notices a session leaving the list, and reacts once, a little later.
 *
 * Why: the same conversation can be open in two editors, and the process of
 * one sends `SessionEnd` when that editor quits — the drain removes the
 * session, while its twin in the other editor is alive. The reaction is a
 * rescan of Claude Code's registry, which brings back whatever still runs,
 * in the folder it was filed in.
 *
 * Later rather than at once: `SessionEnd` runs INSIDE the dying process, so
 * at that instant the registry still lists it as alive. A few seconds on,
 * a clean exit has removed its entry and a twin, if any, is the only one left.
 *
 * Coalesced: several sessions vanishing in a burst — a window reload ends
 * them all — schedule one reaction, not one each. `schedule` is injected so
 * that the tests fire it by hand.
 */
export class VanishWatch {
  private previous: ReadonlySet<string> | undefined;
  private cancel: (() => void) | undefined;

  constructor(
    private readonly onVanish: () => void,
    private readonly schedule: (fire: () => void) => () => void,
  ) {}

  observe(ids: Iterable<string>): void {
    const current = new Set(ids);
    const gone = this.previous === undefined ? [] : vanishedIds(this.previous, current);
    this.previous = current;
    if (gone.length === 0 || this.cancel !== undefined) return;
    this.cancel = this.schedule(() => {
      this.cancel = undefined;
      this.onVanish();
    });
  }

  dispose(): void {
    this.cancel?.();
    this.cancel = undefined;
  }
}
