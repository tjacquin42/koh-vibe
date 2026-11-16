import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type Ref } from 'react';
import type { Action, ActionResult } from '../../src/shared/actions';
import { type ReopenOutcome, type SidebarTab, type Snapshot, type ViewContext } from '../../src/shared/protocol';
import type { Bridge } from './bridge';
import { sampleSheet, sampleSnapshot } from './fixture';
import { countsOf } from './format';
import { translator, type Translate } from './i18n';
import { answered, expire, onSnapshot, startBusy, type Busy } from './busy';
import { REOPEN_WAIT_MS, settleReopening, startReopening, stopReopening, type Reopening, type WaitUntil } from './reopen';
import { isEmpty, search } from './search';
import { activeSessionId } from './sections';
import { CockpitBody, CockpitTabs, CockpitTop } from './cockpit/Cockpit';
import { Icon, type IconName } from './ui/icons';
import { useFlip } from './ui/flip';
import { useReorder } from './ui/reorder';
import { useIconsOnly } from './ui/fit';
import { brandName, type Brand } from './ui/brand';
import { TipLayer } from './ui/Tip';
import { showStoredTheme } from './ui/theme';
import { Section } from './ui/Section';
import { atLaunch, dismiss, parseUiState, setFolds, toggleFold, type UiState } from './ui-state';
import { ArtifactRow, ArtifactsTab } from './views/Artifacts';
import type { ViewCtx } from './views/context';
import { ProcessesTab } from './views/Processes';
import { SettingsPanel } from './views/Settings';
import { RoutinesTab } from './views/Routines';
import { ClosedRow, SessionRow, SessionsTab } from './views/Sessions';
import { UsageStrip, UsageTab } from './views/Usage';
import { NO_MENU, TEXT_MENU } from './ui/menu-context';
import { StatusCounts } from './ui/StatusCounts';

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
          context: { surface: new URLSearchParams(location.search).get('surface') === 'cockpit' ? 'cockpit' : 'sidebar', language: navigator.language, version: 'preview', launch: String(Date.now()), languageChoice: 'auto' },
          snapshot: sampleSnapshot(Date.now()),
        },
  );
  const [ui, setUi] = useState<UiState>(() => {
    const saved = parseUiState(bridge.load());
    // The preview has no init message: its page load is its start.
    return bridge.inEditor ? saved : atLaunch(saved, String(Date.now()), sampleSnapshot(Date.now()).folders.map((f) => f.id));
  });
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
  // Rows whose action is under way (busy.ts).
  const [busy, setBusy] = useState<Busy>(() => new Map());
  const toastTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    const off = bridge.listen((m) => {
      if (m.type === 'init') {
        setState({ context: m.context, snapshot: m.snapshot });
        // A new start of the extension: every folder starts folded (ui-state.ts atLaunch).
        const ids = m.snapshot.folders.map((f) => f.id);
        setUi((prev) => {
          const next = atLaunch(prev, m.context.launch, ids);
          if (next !== prev) bridge.save(next);
          return next;
        });
      }
      else if (m.type === 'snapshot') {
        setState((prev) => (prev === undefined ? prev : { ...prev, snapshot: m.snapshot }));
        setBusy(onSnapshot);
      }
      // A build that found nothing new: what an action changed, if anything, is on screen.
      else if (m.type === 'steady') setBusy(onSnapshot);
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

  // The tab a view shows, for what the host reads only behind it — the
  // conversations' spending behind Usage, in the sidebar or the cockpit.
  const cockpitView = ui.cockpit.view;
  useEffect(() => {
    const surface = state?.context.surface;
    if (surface === undefined) return;
    bridge.post({ type: 'tab', tab: surface === 'cockpit' ? (cockpitView === 'usage' ? 'usage' : 'sessions') : ui.tab });
  }, [bridge, ui.tab, cockpitView, state?.context.surface]);

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
    if (snapshotNow !== undefined) setReopening((r) => settleReopening(r, snapshotNow, Date.now(), activeSessionId(snapshotNow)));
  }, [snapshotNow, now]);

  // The colours chosen in the settings (ui/theme.ts), in every view.
  const tune = snapshotNow?.theme?.current;
  // Every field of the tuning, the background included (15/11): a field left out here kept the old one once the settings closed.
  useEffect(() => showStoredTheme(tune), [tune?.hue, tune?.saturation, tune?.brightness, tune?.grain, tune?.textures.join(), tune?.ground]);

  const awaitOpen = useCallback((sessionId: string, until: WaitUntil = 'open') => {
    setReopening((r) => startReopening(r, sessionId, Date.now(), until));
    // The cap must not wait for the next snapshot to be noticed.
    window.setTimeout(
      () => setReopening((r) => (r.has(sessionId) && Date.now() - (r.get(sessionId)?.since ?? 0) >= REOPEN_WAIT_MS ? stopReopening(r, sessionId) : r)),
      REOPEN_WAIT_MS + 50,
    );
  }, []);

  // Every button that opens a conversation: it loads until the tab is in front (15/11).
  const openConversation = useCallback(
    (id: string) => {
      const origin = state?.snapshot.sessions.find((s) => s.id === id)?.origin;
      awaitOpen(id, origin === 'vscode' ? 'front' : 'open');
      bridge.post({ type: 'openSession', sessionId: id });
    },
    [awaitOpen, bridge, state?.snapshot],
  );

  const reopen = useCallback(
    (sessionId: string) => {
      awaitOpen(sessionId);
      setNotices((n) => {
        if (!n.has(sessionId)) return n;
        const next = new Map(n);
        next.delete(sessionId);
        return next;
      });
      bridge.post({ type: 'reopenClosed', sessionId });
    },
    [bridge, awaitOpen],
  );

  // The caps of busy.ts need a clock only while something is busy.
  const anyBusy = busy.size > 0;
  useEffect(() => {
    if (!anyBusy) return;
    const id = window.setInterval(() => setBusy((b) => expire(b, Date.now())), 400);
    return () => window.clearInterval(id);
  }, [anyBusy]);

  /** Marks `key` busy now, until `p` answers and the screen shows it (busy.ts). */
  const track = useCallback(<T,>(key: string, p: Promise<T>, hold = 2_500): Promise<T> => {
    setBusy((b) => startBusy(b, key, Date.now(), hold));
    const done = (): void => setBusy((b) => answered(b, key, Date.now()));
    p.then(done, done);
    return p;
  }, []);

  const showToast = useCallback((text: string) => {
    setToast(text);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(undefined), 6_000);
  }, []);

  /**
   * Sends a change and resolves with the host's answer. A refusal is shown
   * here, once, so no caller has to remember to. Outside the editor there is
   * no host: the preview answers yes and nothing changes — but the theme,
   * which it keeps, so the colours can be tried there.
   */
  const act = useCallback(
    (action: Action): Promise<ActionResult> => {
      if (!bridge.inEditor) {
        if (action.kind === 'theme.set') setState((prev) => (prev === undefined ? prev : { ...prev, snapshot: { ...prev.snapshot, theme: action.theme } }));
        return Promise.resolve({ ok: true });
      }
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
    return <BootBrand label={t('live.wait')} name={t('app.name')} />;
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
    setFolded: (keys, folded) => updateUi((prev) => setFolds(prev, keys, folded)),
    reopening: new Set(reopening.keys()),
    reopenNotice: (id) => notices.get(id),
    reopen,
    awaitOpen,
    act,
    notify: showToast,
    isBusy: (key) => busy.has(key),
    activeId: activeSessionId(snapshot),
    isDismissed: (id, at) => ui.dismissed[id] === at,
    sort: ui.sort,
    archives: ui.archives,
    spendWindow: ui.spendWindow,
    setSpendWindow: (spendWindow) => updateUi((prev) => ({ ...prev, spendWindow })),
    languageChoice: context.languageChoice,
    dismiss: (id, at) => updateUi((prev) => dismiss(prev, id, at, snapshot.sessions.filter((s) => s.status === 'waiting').map((s) => s.id))),
    track,
    show: (id) => (context.surface === 'cockpit' ? setSheet(id) : openConversation(id)),
    open: (id) => openConversation(id),
  };
  if (context.surface === 'cockpit') {
    return (
      <div className="app surface-cockpit titles-two" data-vscode-context={NO_MENU}>
        <TipLayer />
        {!bridge.inEditor && <div className="preview">{t('preview.banner')}</div>}
        <Header t={t} snapshot={snapshot} surface={context.surface} version={context.version} onCockpit={() => undefined} />
        <CockpitTop ctx={ctx} folder={ui.cockpit.folder} onFolder={(folder) => updateUi((prev) => ({ ...prev, cockpit: { ...prev.cockpit, folder } }))} />
        <CockpitTabs
          ctx={ctx}
          view={ui.cockpit.view}
          order={ui.viewOrder}
          onOrder={(viewOrder) => updateUi((prev) => ({ ...prev, viewOrder }))}
          sheet={sheet}
          onView={(view) => {
            setSheet(undefined);
            updateUi((prev) => ({ ...prev, cockpit: { ...prev.cockpit, view } }));
          }}
        />
        <CockpitBody ctx={ctx} ui={ui.cockpit} setUi={(next) => updateUi((prev) => ({ ...prev, cockpit: { ...prev.cockpit, ...next } }))} sheet={sheet} onSheet={setSheet} />
      </div>
    );
  }
  const results = search(snapshot, query);
  return (
    // Titles on two lines, names beside the tabs' icons: always so since 15/11.
    <div className={`app surface-${context.surface} titles-two`} data-vscode-context={NO_MENU}>
      <TipLayer />
      {!bridge.inEditor && <div className="preview">{t('preview.banner')}</div>}
      <Header
        t={t}
        snapshot={snapshot}
        surface={context.surface}
        version={context.version}
        onCockpit={() => bridge.post({ type: 'openCockpit' })}
        onNew={() => void track('new:', act({ kind: 'session.new' }), 4_000)}
        newBusy={busy.has('new:')}
        settingsOpen={settingsOpen}
        onSettings={() => setSettingsOpen((v) => !v)}
      />
      {settingsOpen ? (
        <main className="body">
          <SettingsPanel
            ctx={ctx}
            onClose={() => setSettingsOpen(false)}
            showUsage={ui.showUsage}
            onShowUsage={(on) => updateUi((prev) => ({ ...prev, showUsage: on }))}
            onSort={(sort) => updateUi((prev) => ({ ...prev, sort }))}
            onArchives={(archives) => updateUi((prev) => ({ ...prev, archives }))}
          />
        </main>
      ) : (
        <>
          <SearchBox t={t} query={query} onChange={setQuery} />
          {results === undefined && (
            <Tabs
              t={t}
              tab={ui.tab}
              order={ui.tabOrder}
              names
              animate={ctx.animate}
              onTab={(tab) => updateUi((prev) => ({ ...prev, tab }))}
              onOrder={(tabOrder) => updateUi((prev) => ({ ...prev, tabOrder }))}
            />
          )}
          <main className="body" id="panel" role={results === undefined ? 'tabpanel' : undefined}>
            {results !== undefined ? <Results ctx={ctx} results={results} query={query} /> : <TabBody ctx={ctx} tab={ui.tab} />}
          </main>
          {ui.tab !== 'usage' && ui.showUsage && <UsageStrip ctx={ctx} />}
        </>
      )}
      {toast !== undefined && (
        <div className="toast" role="status">
          <span>{toast}</span>
          <button type="button" className="tbtn" aria-label={t('action.close')} onClick={() => setToast(undefined)}>
            <Icon name="close" />
          </button>
        </div>
      )}
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
  version,
  onCockpit,
  onNew,
  newBusy,
  settingsOpen,
  onSettings,
}: {
  t: Translate;
  snapshot: Snapshot;
  surface: string;
  /** The extension's version: shown when it is one (not « preview »). */
  version: string;
  onCockpit(): void;
  onNew?: () => void;
  newBusy?: boolean;
  settingsOpen?: boolean;
  onSettings?: () => void;
}) {
  const c = countsOf(snapshot);
  return (
    <header className="head">
      <div className="title">
        <h1>
          {/* The sidebar's name is striped with the logo's colours (C2, 14/11); the cockpit's title stays as it was. */}
          <BrandName text={surface === 'cockpit' ? t('cockpit.title') : t('app.name')} striped={surface === 'sidebar'} />
        </h1>
        {surface === 'sidebar' && <BrandLogo label={t('app.name')} />}
        {/* The cockpit keeps its title alone (14/11). */}
        {surface === 'sidebar' && /^\d/.test(version) && <span className="ver mono">v{version}</span>}
        {surface === 'sidebar' && (
          <span className="head-tools">
            {onNew !== undefined && (
              <button className={`ibtn${newBusy === true ? ' busy' : ''}`} type="button" onClick={onNew} aria-label={t('action.newSession')} aria-busy={newBusy === true}>
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
      {/* The cockpit counts its chosen folder, under its folders (Cockpit.tsx CockpitTop). */}
      {/* Not over the settings either: they are not about the conversations (14/11). */}
      {surface === 'sidebar' && settingsOpen !== true && (
        <StatusCounts counts={c} t={t} />
      )}
    </header>
  );
}

/**
 * The name, and a rainbow that runs through it on each click (14/11). Every
 * click adds its own band on top of those still running — click fast and
 * several cross the letters at once. Each band is a layer of the same text,
 * transparent but for the band, laid over the name and gone when it is
 * through. Still under the system's reduced motion.
 */
function BrandName({ text, striped = false }: { text: string; striped?: boolean }) {
  const ref = useRef<HTMLButtonElement>(null);
  const word = useRef<HTMLSpanElement>(null);
  return (
    <button
      ref={ref}
      type="button"
      className={`brand${striped ? ' brand-c2' : ''}`}
      aria-label={striped ? text : undefined}
      onClick={() => {
        const el = ref.current;
        if (el === null || typeof el.animate !== 'function' || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
        // The same structure as the name, copied — its letters and boxes —
        // so the band's letters fall on the name's (ui/brand.ts). The
        // stylesheet switches the copy's own stripes and fixes off.
        const band = document.createElement('span');
        band.className = 'brand-band';
        band.setAttribute('aria-hidden', 'true');
        if (word.current !== null) band.appendChild(word.current.cloneNode(true));
        else band.textContent = text;
        el.appendChild(band);
        const run = band.animate([{ backgroundPosition: '100% 0' }, { backgroundPosition: '0% 0' }], { duration: 750, easing: 'cubic-bezier(.4,0,.2,1)' });
        run.onfinish = () => band.remove();
        run.oncancel = () => band.remove();
      }}
    >
      {striped ? <StripedName brand={brandName(text)} spanRef={word} /> : text}
    </button>
  );
}

/**
 * The striped name (ui/brand.ts): the body striped as one, the three letters
 * with a fix of their own, and the final e striped apart.
 */
function StripedName({ brand, spanRef }: { brand: Brand; spanRef?: Ref<HTMLSpanElement> }) {
  return (
    <span ref={spanRef} className="brand-word" aria-hidden="true">
      <span className="brand-name">
        {brand.body.map((p, i) =>
          p.kind === 'text' ? (
            <Fragment key={i}>{p.text}</Fragment>
          ) : p.kind === 'dash' ? (
            <span key={i} className="brand-dash" />
          ) : (
            // The letter stays plain text, painted by the name's stripes; the
            // empty marker after it carries its fix (app.css .brand-fix-*).
            <Fragment key={i}>
              {p.text}
              <span className={`brand-fix brand-fix-${p.fix}`} />
            </Fragment>
          ),
        )}
      </span>
      {brand.tail !== null && <span className="brand-e">{brand.tail}</span>}
    </span>
  );
}

/**
 * While the view waits for the extension (15/11): the striped name, with the
 * rainbow running through it again and again — the click's band, on a loop.
 * Still under the system's reduced motion. The wait itself is said to screen
 * readers only.
 */
function BootBrand({ label, name }: { label: string; name: string }) {
  const brand = brandName(name);
  return (
    <div className="boot" role="status" aria-label={label}>
      <span className="brand brand-c2 boot-brand" aria-hidden="true">
        <StripedName brand={brand} />
        <span className="brand-band boot-band">
          <StripedName brand={brand} />
        </span>
      </span>
    </div>
  );
}

/**
 * The logo alone — a half sun over two strokes of sea — where the sidebar is
 * too narrow for the name (app.css container query). In the logo's own
 * colours, those the name is striped with (15/11): coral, lagoon, sea green.
 * Never a glow nor a pulse (refused, 14/11).
 */
function BrandLogo({ label }: { label: string }) {
  return (
    <span className="brand-logo" role="img" aria-label={label}>
      <svg viewBox="36 56 184 176" width="26" height="25" aria-hidden="true">
        <path d="M53 139A75 75 0 0 1 203 139Z" fill="var(--wait)" />
        <path d="M43 181H149" fill="none" stroke="var(--run)" strokeWidth="21" strokeLinecap="round" />
        <path d="M107 219H213" fill="none" stroke="var(--done)" strokeWidth="21" strokeLinecap="round" />
      </svg>
    </span>
  );
}

function SearchBox({ t, query, onChange }: { t: Translate; query: string; onChange(q: string): void }) {
  return (
    <div className="search">
      <Icon name="search" />
      <input
        data-vscode-context={TEXT_MENU}
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

/** The sidebar's tabs, in the order the user dragged them to (ui/reorder.ts). */
const TAB_ICON: Record<SidebarTab, IconName> = { sessions: 'chat', artifacts: 'doc', routines: 'clock', processes: 'term', usage: 'bars' };

/**
 * The sidebar's tabs, in the order the user dragged them to (ui/reorder.ts),
 * an icon each and its name beside it (14/11) — unless the settings say
 * icons only, or the names do not fit: then the name is the tooltip.
 */
function Tabs({
  t,
  tab,
  order,
  names,
  animate,
  onTab,
  onOrder,
}: {
  t: Translate;
  tab: SidebarTab;
  order: readonly SidebarTab[];
  names: boolean;
  animate: boolean;
  onTab(tab: SidebarTab): void;
  onOrder(order: SidebarTab[]): void;
}) {
  const nav = useRef<HTMLElement>(null);
  useFlip(nav, animate);
  const { shown, itemProps, barProps } = useReorder(order, onOrder);
  const iconsOnly = useIconsOnly(nav, names);
  return (
    <nav ref={nav} className={`tabs${iconsOnly ? ' icons-only' : ''}`} role="tablist" aria-label={t('tabs.label')} {...barProps}>
      {shown.map((id) => (
        <button
          key={id}
          type="button"
          role="tab"
          data-flip={`tab:${id}`}
          data-name={t(`tab.${id}`)}
          aria-selected={tab === id}
          aria-controls="panel"
          aria-label={iconsOnly ? t(`tab.${id}`) : undefined}
          data-tip={iconsOnly ? t(`tab.${id}`) : undefined}
          onClick={() => onTab(id)}
          {...itemProps(id)}
        >
          <Icon name={TAB_ICON[id]} />
          {!iconsOnly && <span>{t(`tab.${id}`)}</span>}
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
