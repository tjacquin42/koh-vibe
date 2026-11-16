import type { Action, ActionResult, LanguageChoice } from '../../src/shared/actions';
import type { ReopenOutcome, Snapshot, SpendWindow } from '../../src/shared/protocol';
import type { Bridge } from './bridge';
import type { Translate } from './i18n';
import type { SessionSort } from './sections';
import type { ArchiveCount } from './ui-state';

/** What every tab needs, passed down once rather than prop by prop. */
export interface ViewCtx {
  t: Translate;
  language: string;
  now: number;
  snapshot: Snapshot;
  /** Every listed conversation's folder id (format.ts `folderIndex`), worked out once per snapshot. */
  where: ReadonlyMap<string, string>;
  bridge: Bridge;
  /** The setting AND the view's own reduced-motion check (CSS) both apply. */
  animate: boolean;
  isFolded(key: string): boolean;
  toggle(key: string): void;
  /** Folds or unfolds several sections at once. */
  setFolded(keys: readonly string[], folded: boolean): void;
  /** Conversations V1 is bringing back: their row spins until they are open again. */
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
  /**
   * Goes to a conversation, from anywhere (15/11): V1 brings its tab
   * forward, and whatever was clicked shows it loading until it is in front
   * (`reopening`) — any button that opens a conversation goes through here.
   */
  open(sessionId: string): void;
  /** The conversation whose tab is in front, when it can be told (sections.ts `activeSessionId`). */
  activeId: string | undefined;
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
  /** How many closed conversations the Archives show. */
  archives: ArchiveCount;
  /** The window « Hungriest conversations » shows, and how to change it — kept between visits (16/11). */
  spendWindow: SpendWindow;
  setSpendWindow(w: SpendWindow): void;
  /** The language picked in the settings (`auto` follows the editor). */
  languageChoice: LanguageChoice;
}
