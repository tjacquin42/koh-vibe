import type { Snapshot } from '../../../src/shared/protocol';
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
}
