import type { Action, ActionResult, LanguageChoice } from '../../../src/shared/actions';
import type { ReopenOutcome, Snapshot } from '../../../src/shared/protocol';
import type { SessionSort } from '../sections';
import type { Bridge } from '../bridge';
import type { Translate } from '../i18n';

/** What every tab needs, passed down once rather than prop by prop. */
export interface ViewCtx {
  t: Translate;
  language: string;
  now: number;
  snapshot: Snapshot;
  bridge: Bridge;
  /** The setting AND the view's own reduced-motion check (CSS) both apply. */
  animate: boolean;
  isFolded(key: string): boolean;
  toggle(key: string): void;
  /** Closed conversations V1 is bringing back: their row spins. */
  reopening: ReadonlySet<string>;
  /** Why the last click on that row brought nothing back, for a few seconds. */
  reopenNotice(sessionId: string): Exclude<ReopenOutcome, 'v1'> | undefined;
  reopen(sessionId: string): void;
  /** A change, answered by the host; a refusal is already shown when it resolves. */
  act(action: Action): Promise<ActionResult>;
  /** A short line at the bottom that goes away — for what worked and is worth saying. */
  notify(text: string): void;
  /**
   * What a click on a conversation does where it sits: in the cockpit, its
   * sheet; in the sidebar, its tab.
   */
  show(sessionId: string): void;
  /** Whether the row keyed `key` has an action under way (busy.ts). */
  isBusy(key: string): boolean;
  /**
   * Shows `key` busy from now until `p` answers and the next snapshot is in —
   * or `hold` ms after the answer when nothing on disk changes.
   */
  track<T>(key: string, p: Promise<T>, hold?: number): Promise<T>;
  /** Whether this « For you » card was closed, and nothing happened since. */
  isDismissed(sessionId: string, lastEventAt: number): boolean;
  dismiss(sessionId: string, lastEventAt: number): void;
  /** How a folder's conversations are ordered. */
  sort: SessionSort;
  /** The language picked in the settings (`auto` follows the editor). */
  languageChoice: LanguageChoice;
}
