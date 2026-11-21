import type { Snapshot } from '../../src/shared/protocol';
import type { ViewCtx } from '../src/context';
import { sampleSnapshot } from '../src/fixture';
import { folderIndex } from '../src/format';
import { translator } from '../src/i18n';
import { activeSessionId } from '../src/sections';

/** The moment the sample is built at: fixed, so what is drawn does not move from one run to the next. */
export const NOW = Date.UTC(2026, 10, 16, 12, 0);

/**
 * What the view's parts are handed (context.ts), over the sample snapshot:
 * nothing folded, nothing busy, every action answered yes and remembered in
 * `acted`. `over` changes what a test is about.
 */
export function testCtx(over: Partial<ViewCtx> & { snapshot?: Snapshot; language?: string } = {}): ViewCtx & { acted: unknown[] } {
  const snapshot = over.snapshot ?? sampleSnapshot(NOW);
  const language = over.language ?? 'en';
  const acted: unknown[] = [];
  return {
    t: translator(language),
    language,
    now: NOW,
    snapshot,
    where: folderIndex(snapshot),
    bridge: { inEditor: false, post: () => undefined, listen: () => () => undefined, load: () => undefined, save: () => undefined },
    animate: true,
    isFolded: () => false,
    toggle: () => undefined,
    setFolded: () => undefined,
    reopening: new Set(),
    reopenNotice: () => undefined,
    reopen: () => undefined,
    act: async (action) => {
      acted.push(action);
      return { ok: true };
    },
    menu: async (item, context) => {
      acted.push({ menu: item, context });
    },
    notify: () => undefined,
    show: () => undefined,
    open: () => undefined,
    activeId: activeSessionId(snapshot),
    isBusy: () => false,
    track: (_key, p) => p,
    sort: 'status',
    archives: 10,
    spendWindow: '5h',
    setSpendWindow: () => undefined,
    languageChoice: 'auto',
    ...over,
    acted,
  };
}
