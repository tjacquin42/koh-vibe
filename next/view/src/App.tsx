import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Action, ActionResult } from '../../src/shared/actions';
import { SIDEBAR_TABS, type ReopenOutcome, type SidebarTab, type Snapshot, type ViewContext } from '../../src/shared/protocol';
import type { Bridge } from './bridge';
import { sampleSheet, sampleSnapshot } from './fixture';
import { countsOf } from './format';
import { translator, type Translate } from './i18n';
import { REOPEN_WAIT_MS, settleReopening, startReopening, stopReopening, type Reopening } from './reopen';
import { isEmpty, search } from './search';
import { CockpitBody } from './cockpit/Cockpit';
import { Icon } from './ui/icons';
import { Section } from './ui/Section';
import { parseUiState, toggleFold, type UiState } from './ui-state';
import { ArtifactRow, ArtifactsTab } from './views/Artifacts';
import type { ViewCtx } from './views/context';
import { ProcessesTab } from './views/Processes';
import { SettingsPanel } from './views/Settings';
import { RoutinesTab } from './views/Routines';
import { ClosedRow, SessionRow, SessionsTab } from './views/Sessions';
import { UsageStrip, UsageTab } from './views/Usage';

interface State {
  context: ViewContext;
  snapshot: Snapshot;
}

/** Ticks twice a minute so ages stay right between snapshots. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

export function App({ bridge }: { bridge: Bridge }) {
  const [state, setState] = useState<State | undefined>(() =>
    bridge.inEditor
      ? undefined
      : {
          // ?surface=cockpit previews the cockpit tab in the browser.
          context: { surface: new URLSearchParams(location.search).get('surface') === 'cockpit' ? 'cockpit' : 'sidebar', language: navigator.language, version: 'preview' },
          snapshot: sampleSnapshot(Date.now()),
        },
  );
  const [ui, setUi] = useState<UiState>(() => parseUiState(bridge.load()));
  const [query, setQuery] = useState('');
  const [reopening, setReopening] = useState<Reopening>(() => new Map());
  const [notices, setNotices] = useState<ReadonlyMap<string, Exclude<ReopenOutcome, 'v1'>>>(() => new Map());
  const [settingsOpen, setSettingsOpen] = useState(false);
  // The cockpit's sheet: which conversation it shows (Sheet.tsx).
  const [sheet, setSheet] = useState<string | undefined>();
  // Actions waiting for the host's answer, by request number.
  const pending = useRef(new Map<number, (r: ActionResult) => void>());
  const nextReq = useRef(1);
  const [toast, setToast] = useState<string | undefined>();
  const toastTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    const off = bridge.listen((m) => {
      if (m.type === 'init') setState({ context: m.context, snapshot: m.snapshot });
      else if (m.type === 'snapshot') setState((prev) => (prev === undefined ? prev : { ...prev, snapshot: m.snapshot }));
      else if (m.type === 'showSheet') setSheet(m.sessionId);
      else if (m.type === 'acted') {
        pending.current.get(m.req)?.(m.result);
        pending.current.delete(m.req);
      } else if (m.outcome !== 'v1') {
        // Nothing is on its way: stop the spinner now and say why, for a while.
        const { sessionId, outcome } = m;
        setReopening((r) => stopReopening(r, sessionId));
        setNotices((n) => new Map(n).set(sessionId, outcome));
        window.setTimeout(() => setNotices((n) => {
          const next = new Map(n);
          next.delete(sessionId);
          return next;
        }), 8_000);
      }
    });
    bridge.post({ type: 'ready' });
    return off;
  }, [bridge]);

  // The host builds the sheet of the conversation shown, and of no other.
  useEffect(() => {
    if (state?.context.surface === 'cockpit') bridge.post({ type: 'sheet', sessionId: sheet ?? null });
  }, [bridge, sheet, state?.context.surface]);

  // The host scans for orphan processes only behind the Processes tab.
  useEffect(() => {
    bridge.post({ type: 'tab', tab: ui.tab });
  }, [bridge, ui.tab]);

  const updateUi = useCallback(
    (next: (prev: UiState) => UiState) => {
      setUi((prev) => {
        const value = next(prev);
        bridge.save(value);
        return value;
      });
    },
    [bridge],
  );

  const t = useMemo(() => translator(state?.context.language ?? navigator.language), [state?.context.language]);
  const now = useNow();

  // A wait ends when the conversation is back, or when V1 lets go of it.
  const snapshotNow = state?.snapshot;
  useEffect(() => {
    if (snapshotNow !== undefined) setReopening((r) => settleReopening(r, snapshotNow, Date.now()));
  }, [snapshotNow, now]);

  const reopen = useCallback(
    (sessionId: string) => {
      setReopening((r) => startReopening(r, sessionId, Date.now()));
      setNotices((n) => {
        if (!n.has(sessionId)) return n;
        const next = new Map(n);
        next.delete(sessionId);
        return next;
      });
      // The 30 s cap must not wait for the next snapshot to be noticed.
      window.setTimeout(() => setReopening((r) => (r.has(sessionId) && Date.now() - (r.get(sessionId) ?? 0) >= REOPEN_WAIT_MS ? stopReopening(r, sessionId) : r)), REOPEN_WAIT_MS + 50);
      bridge.post({ type: 'reopenClosed', sessionId });
    },
    [bridge],
  );

  const showToast = useCallback((text: string) => {
    setToast(text);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(undefined), 6_000);
  }, []);

  /**
   * Sends a change and resolves with the host's answer. A refusal is shown
   * here, once, so no caller has to remember to. Outside the editor there is
   * no host: the preview answers yes and nothing changes.
   */
  const act = useCallback(
    (action: Action): Promise<ActionResult> => {
      if (!bridge.inEditor) return Promise.resolve({ ok: true });
      const req = nextReq.current++;
      return new Promise<ActionResult>((resolve) => {
        pending.current.set(req, resolve);
        bridge.post({ type: 'act', req, action });
      }).then((r) => {
        if (!r.ok) showToast(t(`act.${r.error}`));
        return r;
      });
    },
    [bridge, showToast, t],
  );

  if (state === undefined) {
    return <div className="boot">{t('live.wait')}</div>;
  }
  const { context } = state;
  // Outside the editor no host builds the sheet: the preview makes one up.
  const snapshot = !bridge.inEditor && sheet !== undefined ? { ...state.snapshot, sheet: sampleSheet(sheet, now) } : state.snapshot;
  const ctx: ViewCtx = {
    t,
    language: context.language,
    now,
    snapshot,
    bridge,
    animate: snapshot.settings.animate,
    isFolded: (key) => ui.folded.includes(key),
    toggle: (key) => updateUi((prev) => toggleFold(prev, key)),
    reopening: new Set(reopening.keys()),
    reopenNotice: (id) => notices.get(id),
    reopen,
    act,
    notify: showToast,
    show: (id) => (context.surface === 'cockpit' ? setSheet(id) : bridge.post({ type: 'openSession', sessionId: id })),
  };
  if (context.surface === 'cockpit') {
    return (
      <div className="app surface-cockpit">
        {!bridge.inEditor && <div className="preview">{t('preview.banner')}</div>}
        <Header t={t} snapshot={snapshot} surface={context.surface} onCockpit={() => undefined} />
        <CockpitBody ctx={ctx} ui={ui.cockpit} setUi={(next) => updateUi((prev) => ({ ...prev, cockpit: { ...prev.cockpit, ...next } }))} sheet={sheet} onSheet={setSheet} />
      </div>
    );
  }
  const results = search(snapshot, query);
  return (
    <div className={`app surface-${context.surface}`}>
      {!bridge.inEditor && <div className="preview">{t('preview.banner')}</div>}
      <Header
        t={t}
        snapshot={snapshot}
        surface={context.surface}
        onCockpit={() => bridge.post({ type: 'openCockpit' })}
        onNew={() => void act({ kind: 'session.new' })}
        settingsOpen={settingsOpen}
        onSettings={() => setSettingsOpen((v) => !v)}
      />
      {settingsOpen ? (
        <main className="body">
          <SettingsPanel ctx={ctx} onClose={() => setSettingsOpen(false)} />
        </main>
      ) : (
        <>
          <SearchBox t={t} query={query} onChange={setQuery} />
          {results === undefined && <Tabs t={t} tab={ui.tab} onTab={(tab) => updateUi((prev) => ({ ...prev, tab }))} />}
          <main className="body" id="panel" role={results === undefined ? 'tabpanel' : undefined}>
            {results !== undefined ? <Results ctx={ctx} results={results} query={query} /> : <TabBody ctx={ctx} tab={ui.tab} />}
          </main>
          {ui.tab !== 'usage' && <UsageStrip ctx={ctx} />}
        </>
      )}
      {toast !== undefined && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
      <footer className="foot">
        <span>{t('footer.readonly')}</span>
        {/^\d/.test(context.version) && <span className="mono">v{context.version}</span>}
      </footer>
    </div>
  );
}

function TabBody({ ctx, tab }: { ctx: ViewCtx; tab: SidebarTab }) {
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
}

function Header({
  t,
  snapshot,
  surface,
  onCockpit,
  onNew,
  settingsOpen,
  onSettings,
}: {
  t: Translate;
  snapshot: Snapshot;
  surface: string;
  onCockpit(): void;
  onNew?: () => void;
  settingsOpen?: boolean;
  onSettings?: () => void;
}) {
  const c = countsOf(snapshot);
  return (
    <header className="head">
      <div className="title">
        <h1>{surface === 'cockpit' ? t('cockpit.title') : t('app.name')}</h1>
        <span className="tag">{t('app.next')}</span>
        <span className="live">
          <span className="pulse" aria-hidden="true" />
          {t('live.on')}
        </span>
        {surface === 'sidebar' && (
          <span className="head-tools">
            {onNew !== undefined && (
              <button className="ibtn" type="button" onClick={onNew} aria-label={t('action.newSession')}>
                <Icon name="plus" size={16} />
              </button>
            )}
            {onSettings !== undefined && (
              <button className="ibtn" type="button" onClick={onSettings} aria-label={t('action.settings')} aria-pressed={settingsOpen === true}>
                <Icon name="gear" size={16} />
              </button>
            )}
            <button className="ibtn" type="button" onClick={onCockpit} aria-label={t('action.cockpit')}>
              <Icon name="panel" size={16} />
            </button>
          </span>
        )}
      </div>
      <div className="counts">
        <Count n={c.waiting} label={t('count.waiting')} tone="wait" />
        <Count n={c.running} label={t('count.running')} tone="run" />
        <Count n={c.done} label={t('count.done')} tone="done" />
      </div>
    </header>
  );
}

function Count({ n, label, tone }: { n: number; label: string; tone: string }) {
  return (
    <div className={`count tone-${tone}`}>
      <b>{n}</b>
      <span>{label}</span>
    </div>
  );
}

function SearchBox({ t, query, onChange }: { t: Translate; query: string; onChange(q: string): void }) {
  return (
    <div className="search">
      <Icon name="search" />
      <input
        type="search"
        value={query}
        placeholder={t('search.placeholder')}
        aria-label={t('search.label')}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onChange('');
        }}
      />
      {query.length > 0 && (
        <button type="button" className="tbtn" aria-label={t('search.clear')} onClick={() => onChange('')}>
          <Icon name="close" />
        </button>
      )}
    </div>
  );
}

function Tabs({ t, tab, onTab }: { t: Translate; tab: SidebarTab; onTab(tab: SidebarTab): void }) {
  return (
    <nav className="tabs" role="tablist" aria-label={t('tabs.label')}>
      {SIDEBAR_TABS.map((id) => (
        <button key={id} type="button" role="tab" aria-selected={tab === id} aria-controls="panel" onClick={() => onTab(id)}>
          {t(`tab.${id}`)}
        </button>
      ))}
    </nav>
  );
}

function Results({ ctx, results, query }: { ctx: ViewCtx; results: NonNullable<ReturnType<typeof search>>; query: string }) {
  const { t } = ctx;
  if (isEmpty(results)) return <p className="hint pad">{t('search.none', { q: query.trim() })}</p>;
  return (
    <>
      {results.sessions.length > 0 && (
        <Section title={t('search.sessions')} count={results.sessions.length}>
          {results.sessions.map((s) => (
            <SessionRow key={s.id} ctx={ctx} s={s} />
          ))}
        </Section>
      )}
      {results.closed.length > 0 && (
        <Section title={t('search.closed')} count={results.closed.length}>
          {results.closed.map((c) => (
            <ClosedRow key={c.sessionId} ctx={ctx} c={c} />
          ))}
        </Section>
      )}
      {results.artifacts.length > 0 && (
        <Section title={t('search.artifacts')} count={results.artifacts.length}>
          {results.artifacts.map((a) => (
            <ArtifactRow key={a.slug} ctx={ctx} a={a} />
          ))}
        </Section>
      )}
    </>
  );
}
