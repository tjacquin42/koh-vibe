import type { ClaudeTab } from './dormant';

/** How long a requested opening waits to see its tab appear. */
export const PENDING_OPEN_MS = 15_000;

/** The active tab, as much as this memory needs to know about it. */
export interface ActiveTab {
  title: string;
  group: number;
  index: number;
}

/**
 * The tabs THIS window has itself made open.
 *
 * The editor's memento is the only table that links a tab to its
 * conversation, but it is persisted state: it does not yet know about a tab
 * that was just reopened. The window, on the other hand, knows — it is the
 * one that asked for it. What remains is recognizing the tab when it
 * arrives, and that is the whole point of this class.
 *
 * Two pitfalls, both observed:
 *
 * The first tab event follows the request by a few milliseconds and
 * precedes the panel's appearance: the active tab is still the previous
 * one, often a plain file. A wait that got consumed there would be lost for
 * the tab that arrives right after. So it survives anything that is not a
 * conversation.
 *
 * And the panel appears under « Claude Code » before taking its title half
 * a second later. Keeping the first label would give a stale association
 * right away: the wait stays open and re-registers on every pass, so it is
 * the last observation that counts.
 *
 * It only closes on ANOTHER recognized conversation — the user has moved on
 * to something else — or by expiring.
 */
export class OpenedHere {
  private readonly known = new Map<string, ClaudeTab>();
  private pending: { id: string; at: number; from?: string } | undefined;

  constructor(private readonly ttlMs: number = PENDING_OPEN_MS) {}

  /** This window just requested the tab of `sessionId`. */
  opening(sessionId: string, now: number): void {
    this.pending = { id: sessionId, at: now };
  }

  /**
   * What was learned, to be placed AHEAD OF the memento. Same shape as a
   * memento entry: resolution has nothing special to do with these.
   */
  entries(): ClaudeTab[] {
    return [...this.known.values()];
  }

  /**
   * Takes note of the active tab, and returns the conversation to select.
   *
   * `resolved` is what the usual resolution found — `undefined` when nobody
   * can yet name this tab. `active` is `undefined` the moment the active
   * tab is not a conversation.
   */
  observe(resolved: string | undefined, active: ActiveTab | undefined, now: number): string | undefined {
    if (this.pending !== undefined && now - this.pending.at > this.ttlMs) this.pending = undefined;
    if (this.pending === undefined || active === undefined) return resolved;
    if (resolved !== undefined && resolved !== this.pending.id) {
      // The conversation WE CAME FROM does not count: at the moment of the
      // request, the active tab is still the previous one, and it is often
      // a conversation. Taking it for a change of mind used to close the
      // wait before the requested panel had even appeared — the defect
      // that made selection intermittent. The first one observed is
      // therefore kept as the starting point, and seeing it again proves
      // nothing.
      this.pending.from ??= resolved;
      if (resolved === this.pending.from) return resolved;
      // A THIRD conversation, however: the user has moved on to something
      // else, and continuing to watch would eventually name the wrong tab.
      this.pending = undefined;
      return resolved;
    }
    this.known.set(this.pending.id, { sessionId: this.pending.id, ...active });
    return this.pending.id;
  }
}
