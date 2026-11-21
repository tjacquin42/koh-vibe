import { memo, useMemo, useRef, useState } from 'react';
import type { SidebarTab } from '../../../src/shared/protocol';
import type { ViewCtx } from '../context';
import { useSlide, useSwipe, stepIn } from '../hooks/useSwipe';
import { cx } from '../lib/cx';
import { search } from '../search';
import type { UiState } from '../ui-state';
import type { IconName } from '../components/atoms/Icon';
import { SearchBox } from '../components/molecules/SearchBox';
import { TabBar } from '../components/molecules/TabBar';
import { WaitingCount } from '../components/organisms/WaitingCount';
import { Header } from '../components/organisms/Header';
import { UsageStrip } from '../components/organisms/UsageStrip';
import { ArtifactsTab } from './Artifacts';
import { ProcessesTab } from './Processes';
import { Results } from './Results';
import { RoutinesTab } from './Routines';
import { SessionsTab } from './Sessions';
import { SettingsPanel } from './Settings';
import { UsageTab } from './Usage';

const TAB_ICON: Record<SidebarTab, IconName> = { sessions: 'chat', artifacts: 'doc', routines: 'clock', processes: 'term', usage: 'bars' };

/** The key of the header's « new conversation », for its busy mark (busy.ts). */
const NEW = 'new:';

/**
 * W1: the sidebar. Its header, then the settings in place of everything
 * else, or: the search, the tabs — a search's results in their place — the
 * chosen tab, and the usage at the foot.
 */
export function SidebarPage({ ctx, version, ui, updateUi }: { ctx: ViewCtx; version: string; ui: UiState; updateUi(next: (prev: UiState) => UiState): void }) {
  const { t, snapshot } = ctx;
  const [query, setQuery] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const results = useMemo(() => search(snapshot, query), [snapshot, query]);
  // Two fingers left or right: the next or the previous tab, sliding in (21/11).
  const panel = useRef<HTMLElement>(null);
  useSwipe(panel, !settingsOpen && results === undefined, (step) => {
    const tab = stepIn(ui.tabOrder, ui.tab, step);
    if (tab !== undefined) updateUi((prev) => ({ ...prev, tab }));
  });
  const slide = useSlide(ui.tabOrder, ui.tab, ctx.animate);
  return (
    <>
      <Header
        t={t}
        snapshot={snapshot}
        surface="sidebar"
        version={version}
        waiting={<WaitingCount ctx={ctx} sessions={snapshot.sessions} />}
        tools={{
          onCockpit: () => ctx.bridge.post({ type: 'openCockpit' }),
          onNew: () => void ctx.track(NEW, ctx.act({ kind: 'session.new' }), 4_000),
          newBusy: ctx.isBusy(NEW),
          settingsOpen,
          onSettings: () => setSettingsOpen((v) => !v),
        }}
      />
      {settingsOpen ? (
        <main className="body">
          <SettingsPanel
            ctx={ctx}
            onClose={() => setSettingsOpen(false)}
            showUsage={ui.showUsage}
            onShowUsage={(showUsage) => updateUi((prev) => ({ ...prev, showUsage }))}
            onSort={(sort) => updateUi((prev) => ({ ...prev, sort }))}
            onArchives={(archives) => updateUi((prev) => ({ ...prev, archives }))}
          />
        </main>
      ) : (
        <>
          <SearchBox t={t} query={query} onChange={setQuery} />
          {results === undefined && (
            <TabBar
              className="tabs"
              label={t('tabs.label')}
              order={ui.tabOrder}
              selected={ui.tab}
              icon={TAB_ICON}
              name={(id) => t(`tab.${id}`)}
              flipKey="tab"
              controls="panel"
              animate={ctx.animate}
              onSelect={(tab) => updateUi((prev) => ({ ...prev, tab }))}
              onOrder={(tabOrder) => updateUi((prev) => ({ ...prev, tabOrder }))}
            />
          )}
          <main ref={panel} className="body" id="panel" role={results === undefined ? 'tabpanel' : undefined}>
            {results !== undefined ? (
              <Results ctx={ctx} results={results} query={query} />
            ) : (
              <div key={ui.tab} className={cx('pane', slide)}>
                <TabBody ctx={ctx} tab={ui.tab} />
              </div>
            )}
          </main>
          {ui.tab !== 'usage' && ui.showUsage && <UsageStrip ctx={ctx} />}
        </>
      )}
    </>
  );
}

/** Drawn again only when what it shows changed — not at each key typed in the search, nor when a toast comes and goes. */
const TabBody = memo(function TabBody({ ctx, tab }: { ctx: ViewCtx; tab: SidebarTab }) {
  switch (tab) {
    case 'sessions':
      return <SessionsTab ctx={ctx} />;
    case 'artifacts':
      return <ArtifactsTab ctx={ctx} />;
    case 'routines':
      return <RoutinesTab ctx={ctx} />;
    case 'processes':
      return <ProcessesTab ctx={ctx} />;
    case 'usage':
      return <UsageTab ctx={ctx} />;
  }
});
