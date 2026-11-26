import { useRef } from 'react';
import type { ViewCtx } from '../context';
import type { CockpitView, UiState } from '../ui-state';
import { usePanes } from '../hooks/usePanes';
import { stepIn, useSwipe } from '../hooks/useSwipe';
import type { IconName } from '../components/atoms/Icon';
import { TabBar } from '../components/molecules/TabBar';
import { CockpitTop } from '../components/organisms/CockpitTop';
import { Header } from '../components/organisms/Header';
import { SessionSheet } from '../components/organisms/SessionSheet';
import { Board } from './cockpit/Board';
import { Feed } from './cockpit/Feed';
import { Timeline } from './cockpit/Timeline';
import { Wall } from './cockpit/Wall';
import { UsageTab } from './Usage';

type Cockpit = UiState['cockpit'];

const VIEW_ICON: Record<CockpitView, IconName> = { board: 'columns', wall: 'grid', feed: 'list', timeline: 'clock', usage: 'bars' };

/**
 * W2: the cockpit in an editor tab (14/11): the folders and the counts of
 * the one chosen, the views across the whole width — named in English in
 * every language — then the chosen view, or a conversation's sheet over it.
 * A sheet open under the tabs closes on a click on one of them.
 */
export function CockpitPage({
  ctx,
  version,
  ui,
  updateUi,
  sheet,
  onSheet,
}: {
  ctx: ViewCtx;
  version: string;
  ui: UiState;
  updateUi(next: (prev: UiState) => UiState): void;
  /** The conversation whose sheet takes the cockpit, if any. */
  sheet: string | undefined;
  onSheet(id: string | undefined): void;
}) {
  const { t } = ctx;
  const set = (next: Partial<Cockpit>): void => updateUi((prev) => ({ ...prev, cockpit: { ...prev.cockpit, ...next } }));
  // Two fingers left or right: the next or the previous view, pushed in as macOS moves
  // between its spaces (21/11) — and the same push on a click on a view's tab.
  const area = useRef<HTMLDivElement>(null);
  const panes = usePanes(ui.cockpit.view, ctx.animate);
  const select = (view: CockpitView, focus = false): void => {
    onSheet(undefined);
    panes.go(view, ui.viewOrder.indexOf(view) >= ui.viewOrder.indexOf(ui.cockpit.view) ? 1 : -1, focus);
    set({ view });
  };
  useSwipe(area, true, {
    can: (step) => stepIn(ui.viewOrder, ui.cockpit.view, step) !== undefined,
    drag: panes.drag,
    release: panes.release,
    step: (step) => {
      const view = stepIn(ui.viewOrder, ui.cockpit.view, step);
      if (view !== undefined) select(view, true);
    },
  });
  return (
    <>
      <Header t={t} snapshot={ctx.snapshot} surface="cockpit" version={version} />
      <CockpitTop ctx={ctx} folder={ui.cockpit.folder} onFolder={(folder) => set({ folder })} />
      <TabBar
        className="ck-tabs"
        label={t('cockpit.views')}
        order={ui.viewOrder}
        selected={sheet === undefined ? ui.cockpit.view : undefined}
        icon={VIEW_ICON}
        iconSize={16}
        name={(v) => t(`cockpit.view.${v}`)}
        flipKey="view"
        animate={ctx.animate}
        onSelect={(view) => select(view)}
        onOrder={(viewOrder) => updateUi((prev) => ({ ...prev, viewOrder }))}
      />
      <div ref={area} className="cockpit">
        <main className="ck-main">
          {sheet !== undefined ? (
            <SessionSheet ctx={ctx} id={sheet} onClose={() => onSheet(undefined)} />
          ) : (
            <div className="panes">
              {panes.panes.map((p) => (
                <div key={p.id} {...panes.props(p)}>
                  <ViewBody ctx={ctx} ui={{ ...ui.cockpit, view: p.key }} onSpan={(spanH) => set({ spanH })} />
                </div>
              ))}
            </div>
          )}
        </main>
      </div>
    </>
  );
}

function ViewBody({ ctx, ui, onSpan }: { ctx: ViewCtx; ui: Cockpit; onSpan(h: number): void }) {
  switch (ui.view) {
    case 'board':
      return <Board ctx={ctx} folder={ui.folder} />;
    case 'wall':
      return <Wall ctx={ctx} folder={ui.folder} />;
    case 'feed':
      return <Feed ctx={ctx} folder={ui.folder} />;
    case 'timeline':
      return <Timeline ctx={ctx} folder={ui.folder} spanH={ui.spanH} onSpan={onSpan} />;
    case 'usage':
      // The sidebar's Usage tab as it is: limits, pace marks, the hungriest conversations.
      return (
        <div className="ck-usage">
          <UsageTab ctx={ctx} />
        </div>
      );
  }
}
