import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Action, ActionResult } from '../../src/shared/actions';
import type { ReopenOutcome, Snapshot, ViewContext } from '../../src/shared/protocol';
import type { Bridge } from './bridge';
import { answered, expire, onSnapshot, startBusy, type Busy } from './busy';
import type { ViewCtx } from './context';
import { sampleSheet, sampleSnapshot } from './fixture';
import { folderIndex } from './format';
import { useNow } from './hooks/useNow';
import { translator } from './i18n';
import { setMenuLanguage } from './lib/menu-context';
import { showStoredTheme } from './lib/theme';
import { REOPEN_WAIT_MS, settleReopening, startReopening, stopReopening, type Reopening, type WaitUntil } from './reopen';
import { activeSessionId } from './sections';
import { atLaunch, dismiss, parseUiState, setFolds, toggleFold, type UiState } from './ui-state';
import { Toast } from './components/molecules/Toast';
import { BootBrand } from './components/organisms/Brand';
import { Shell } from './components/templates/Shell';
import { CockpitPage } from './views/CockpitPage';
import { SidebarPage } from './views/SidebarPage';

interface State {
  context: ViewContext;
  snapshot: Snapshot;
}

/** Why a click on a closed conversation brought nothing back, by conversation. */
type Notices = ReadonlyMap<string, Exclude<ReopenOutcome, 'v1'>>;

/** How long such a notice stays under its row, and a toast at the bottom. */
const NOTICE_MS = 8_000;
const TOAST_MS = 6_000;

function without<K, V>(map: ReadonlyMap<K, V>, key: K): ReadonlyMap<K, V> {
  if (!map.has(key)) return map;
  const next = new Map(map);
  next.delete(key);
  return next;
}

/** Outside the editor there is no host: the page shows a sample, and `?surface=cockpit` the cockpit. */
function previewState(): State {
  const surface = new URLSearchParams(location.search).get('surface') === 'cockpit' ? 'cockpit' : 'sidebar';
  return {
    context: { surface, language: navigator.language, version: 'preview', launch: String(Date.now()), languageChoice: 'auto' },
    snapshot: sampleSnapshot(Date.now()),
  };
}

/**
 * The view's own state, and what every part of it is handed (context.ts):
 * what the host last said, what the view remembers between reloads, and what
 * is under way — a click being answered, a conversation being opened. The
 * pages draw it (views/SidebarPage.tsx, views/CockpitPage.tsx).
 */
export function App({ bridge }: { bridge: Bridge }) {
  const [state, setState] = useState<State | undefined>(() => (bridge.inEditor ? undefined : previewState()));
  const [ui, setUi] = useState<UiState>(() => {
    const saved = parseUiState(bridge.load());
    // The preview has no init message: its page load is its start.
    return bridge.inEditor ? saved : atLaunch(saved, String(Date.now()), sampleSnapshot(Date.now()).folders.map((f) => f.id));
  });
  // Conversations being opened: their row spins until they are (reopen.ts).
  const [reopening, setReopening] = useState<Reopening>(() => new Map());
  const [notices, setNotices] = useState<Notices>(() => new Map());
  // The cockpit's sheet: which conversation it shows (organisms/SessionSheet.tsx).
  const [sheet, setSheet] = useState<string | undefined>();
  // Actions waiting for the host's answer, by request number.
  const pending = useRef(new Map<number, (r: ActionResult) => void>());
  const nextReq = useRef(1);
  const [toast, setToast] = useState<string | undefined>();
  const toastTimer = useRef<number | undefined>(undefined);
  // Rows whose action is under way (busy.ts).
  const [busy, setBusy] = useState<Busy>(() => new Map());

  // The snapshot last received, for what happens between two of them.
  const latest = useRef<Snapshot | undefined>(state?.snapshot);
  latest.current = state?.snapshot;
  // A wait ends when the conversation is back, or when V1 lets go of it (reopen.ts).
  const settle = useCallback((): void => {
    const snap = latest.current;
    if (snap !== undefined) setReopening((r) => settleReopening(r, snap, Date.now(), activeSessionId(snap)));
  }, []);

  useEffect(() => {
    const off = bridge.listen((m) => {
      switch (m.type) {
        case 'init': {
          setState({ context: m.context, snapshot: m.snapshot });
          // A new start of the extension: every folder starts folded (ui-state.ts atLaunch).
          const ids = m.snapshot.folders.map((f) => f.id);
          setUi((prev) => {
            const next = atLaunch(prev, m.context.launch, ids);
            if (next !== prev) bridge.save(next);
            return next;
          });
          return;
        }
        case 'snapshot':
          setState((prev) => (prev === undefined ? prev : { ...prev, snapshot: m.snapshot }));
          setBusy(onSnapshot);
          return;
        case 'steady':
          // A build that found nothing new: what an action changed, if anything,
          // is on screen — and a conversation asked for may be in front already,
          // with no snapshot to come and say so.
          setBusy(onSnapshot);
          settle();
          return;
        case 'showSheet':
          setSheet(m.sessionId);
          return;
        case 'acted':
          pending.current.get(m.req)?.(m.result);
          pending.current.delete(m.req);
          return;
        case 'reopen': {
          if (m.outcome === 'v1') return;
          // Nothing is on its way: stop the spinner now and say why, for a while.
          const { sessionId, outcome } = m;
          setReopening((r) => stopReopening(r, sessionId));
          setNotices((n) => new Map(n).set(sessionId, outcome));
          window.setTimeout(() => setNotices((n) => without(n, sessionId)), NOTICE_MS);
          return;
        }
      }
    });
    bridge.post({ type: 'ready' });
    return off;
  }, [bridge, settle]);

  const surface = state?.context.surface;

  // The host builds the sheet of the conversation shown, and of no other.
  useEffect(() => {
    if (surface === 'cockpit') bridge.post({ type: 'sheet', sessionId: sheet ?? null });
  }, [bridge, sheet, surface]);

  // The tab a view shows, for what the host reads only behind it — the
  // processes, the conversations' spending behind Usage, in the sidebar or
  // the cockpit.
  const cockpitView = ui.cockpit.view;
  useEffect(() => {
    if (surface === undefined) return;
    bridge.post({ type: 'tab', tab: surface === 'cockpit' ? (cockpitView === 'usage' ? 'usage' : 'sessions') : ui.tab });
  }, [bridge, ui.tab, cockpitView, surface]);

  const updateUi = useCallback(
    (next: (prev: UiState) => UiState) => {
      setUi((prev) => {
        const value = next(prev);
        if (value !== prev) bridge.save(value);
        return value;
      });
    },
    [bridge],
  );

  const language = state?.context.language ?? navigator.language;
  const t = useMemo(() => {
    // The right-click menus speak it too, before any row is drawn (lib/menu-context.ts).
    setMenuLanguage(language);
    return translator(language);
  }, [language]);
  const now = useNow();

  // Outside the editor no host builds the sheet: the preview makes one up.
  const received = state?.snapshot;
  const snapshot = useMemo(
    () => (received !== undefined && !bridge.inEditor && sheet !== undefined ? { ...received, sheet: sampleSheet(sheet, Date.now()) } : received),
    [received, bridge, sheet],
  );
  const where = useMemo(() => (snapshot === undefined ? new Map<string, string>() : folderIndex(snapshot)), [snapshot]);
  const activeId = useMemo(() => (snapshot === undefined ? undefined : activeSessionId(snapshot)), [snapshot]);

  // At each snapshot, and at each tick of the clock for the wait that never ends.
  useEffect(settle, [settle, received, now]);

  // The colours chosen in the settings (lib/theme.ts), in every view.
  const tune = snapshot?.theme?.current;
  // Every field of the tuning, the background included (15/11): a field left out here kept the old one once the settings closed.
  useEffect(() => showStoredTheme(tune), [tune?.hue, tune?.saturation, tune?.brightness, tune?.grain, tune?.textures.join(), tune?.ground]);

  const awaitOpen = useCallback((sessionId: string, until: WaitUntil = 'open') => {
    setReopening((r) => startReopening(r, sessionId, Date.now(), until));
    // The cap must not wait for the next snapshot to be noticed.
    window.setTimeout(
      () => setReopening((r) => (Date.now() - (r.get(sessionId)?.since ?? Infinity) >= REOPEN_WAIT_MS ? stopReopening(r, sessionId) : r)),
      REOPEN_WAIT_MS + 50,
    );
  }, []);

  // Every button that opens a conversation: it loads until the tab is in front (15/11).
  // The snapshot is read at the click: the function stays the same from one to the next.
  const openConversation = useCallback(
    (id: string) => {
      const origin = latest.current?.sessions.find((s) => s.id === id)?.origin;
      awaitOpen(id, origin === 'vscode' ? 'front' : 'open');
      bridge.post({ type: 'openSession', sessionId: id });
    },
    [awaitOpen, bridge],
  );

  const reopen = useCallback(
    (sessionId: string) => {
      awaitOpen(sessionId);
      setNotices((n) => without(n, sessionId));
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
    toastTimer.current = window.setTimeout(() => setToast(undefined), TOAST_MS);
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

  const folded = useMemo(() => new Set(ui.folded), [ui.folded]);
  const opening = useMemo(() => new Set(reopening.keys()), [reopening]);
  const languageChoice = state?.context.languageChoice ?? 'auto';
  // One object for every part of the view, the same until something it says changes:
  // a toast, a key typed in the search, redraw nothing that reads it (SidebarPage).
  const ctx = useMemo<ViewCtx | undefined>(() => {
    if (snapshot === undefined || surface === undefined) return undefined;
    return {
      t,
      language,
      now,
      snapshot,
      where,
      bridge,
      animate: snapshot.settings.animate,
      isFolded: (key) => folded.has(key),
      toggle: (key) => updateUi((prev) => toggleFold(prev, key)),
      setFolded: (keys, on) => updateUi((prev) => setFolds(prev, keys, on)),
      reopening: opening,
      reopenNotice: (id) => notices.get(id),
      reopen,
      act,
      notify: showToast,
      isBusy: (key) => busy.has(key),
      activeId,
      isDismissed: (id, at) => ui.dismissed[id] === at,
      dismiss: (id, at) => updateUi((prev) => dismiss(prev, id, at, snapshot.sessions.filter((s) => s.status === 'waiting').map((s) => s.id))),
      sort: ui.sort,
      archives: ui.archives,
      spendWindow: ui.spendWindow,
      setSpendWindow: (spendWindow) => updateUi((prev) => ({ ...prev, spendWindow })),
      languageChoice,
      track,
      show: (id) => (surface === 'cockpit' ? setSheet(id) : openConversation(id)),
      open: openConversation,
    };
  }, [t, language, now, snapshot, where, bridge, folded, opening, notices, busy, activeId, ui.dismissed, ui.sort, ui.archives, ui.spendWindow, languageChoice, surface, updateUi, reopen, act, showToast, track, openConversation]);

  if (state === undefined || ctx === undefined || surface === undefined) {
    return <BootBrand label={t('live.wait')} />;
  }
  const { version } = state.context;
  return (
    <Shell
      surface={surface}
      banner={bridge.inEditor ? undefined : t('preview.banner')}
      toast={toast !== undefined && <Toast text={toast} closeLabel={t('action.close')} onClose={() => setToast(undefined)} />}
    >
      {surface === 'cockpit' ? (
        <CockpitPage ctx={ctx} version={version} ui={ui} updateUi={updateUi} sheet={sheet} onSheet={setSheet} />
      ) : (
        <SidebarPage ctx={ctx} version={version} ui={ui} updateUi={updateUi} />
      )}
    </Shell>
  );
}
