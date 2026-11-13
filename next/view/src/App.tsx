import { useEffect, useMemo, useState } from 'react';
import type { FolderView, SessionView, Snapshot, ViewContext } from '../../src/shared/protocol';
import type { Bridge } from './bridge';
import { sampleSnapshot } from './fixture';
import { countsOf, formatAge, formatTokens, sessionDetail, sessionTitle, toneOf } from './format';
import { translator, type Translate } from './i18n';

/** V1's neutral folder colors, drawn from the Koh palette. Unknown ids show no color. */
const FOLDER_COLORS: Record<string, string> = {
  blue: '#5CC8F0',
  indigo: '#8A9BFF',
  cyan: '#6FE3E0',
  green: '#7EE0A8',
  lime: '#C3EB7A',
  yellow: '#F5D06B',
  orange: '#FF9E5E',
  red: '#FF7A7A',
  pink: '#F59AC8',
  purple: '#B9A6FF',
};

interface State {
  context: ViewContext;
  snapshot: Snapshot;
}

/** Ticks once a minute so ages stay right between snapshots. */
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
      : { context: { surface: 'sidebar', language: navigator.language, version: 'preview' }, snapshot: sampleSnapshot(Date.now()) },
  );

  useEffect(() => {
    const off = bridge.listen((m) => {
      if (m.type === 'init') setState({ context: m.context, snapshot: m.snapshot });
      else setState((prev) => (prev === undefined ? prev : { ...prev, snapshot: m.snapshot }));
    });
    bridge.post({ type: 'ready' });
    return off;
  }, [bridge]);

  const t = useMemo(() => translator(state?.context.language ?? navigator.language), [state?.context.language]);
  const now = useNow();

  if (state === undefined) {
    return <div className="boot">{t('live.wait')}</div>;
  }
  const { context, snapshot } = state;
  return (
    <div className={`app surface-${context.surface}`}>
      {!bridge.inEditor && <div className="preview">{t('preview.banner')}</div>}
      <Header t={t} snapshot={snapshot} surface={context.surface} onCockpit={() => bridge.post({ type: 'openCockpit' })} />
      {context.surface === 'cockpit' && <p className="soon">{t('cockpit.soon')}</p>}
      <main className="body">
        <SessionList t={t} snapshot={snapshot} now={now} onOpen={(id) => bridge.post({ type: 'openCockpit', sessionId: id })} />
      </main>
      <Usage t={t} snapshot={snapshot} now={now} />
      <footer className="foot">
        <span>{t('footer.readonly')}</span>
        {/^\d/.test(context.version) && <span className="mono">v{context.version}</span>}
      </footer>
    </div>
  );
}

function Header({ t, snapshot, surface, onCockpit }: { t: Translate; snapshot: Snapshot; surface: string; onCockpit(): void }) {
  const c = countsOf(snapshot);
  return (
    <header className="head">
      <div className="title">
        <h1>{surface === 'cockpit' ? t('cockpit.title') : t('app.name')}</h1>
        <span className="tag">{t('app.next')}</span>
        <span className="live" title={t('live.on')}>
          <span className="pulse" aria-hidden="true" />
          {t('live.on')}
        </span>
        {surface === 'sidebar' && (
          <button className="ibtn" type="button" onClick={onCockpit} title={t('action.cockpit')} aria-label={t('action.cockpit')}>
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
              <rect x="2" y="3" width="12" height="10" rx="2" fill="none" stroke="currentColor" strokeWidth="1.4" />
              <path d="M6 3v10" stroke="currentColor" strokeWidth="1.4" />
            </svg>
          </button>
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

function SessionList({ t, snapshot, now, onOpen }: { t: Translate; snapshot: Snapshot; now: number; onOpen(id: string): void }) {
  const byId = useMemo(() => new Map(snapshot.sessions.map((s) => [s.id, s])), [snapshot.sessions]);
  if (snapshot.sessions.length === 0) {
    return (
      <div className="empty">
        <h2>{t('empty.title')}</h2>
        <p>{t('empty.body')}</p>
      </div>
    );
  }
  const unfiled: FolderView = { id: '', name: t('folder.unfiled'), sessionIds: snapshot.unfiled };
  return (
    <>
      {[...snapshot.folders, unfiled]
        .filter((f) => f.sessionIds.length > 0)
        .map((f) => (
          <section key={f.id || 'unfiled'} className="folder">
            <h2 className="sec">
              <span className="fold" style={{ background: (f.color !== undefined ? FOLDER_COLORS[f.color] : undefined) ?? 'var(--line)' }} />
              {f.name}
              <span className="n">{f.sessionIds.length}</span>
            </h2>
            {f.sessionIds
              .map((id) => byId.get(id))
              .filter((s): s is SessionView => s !== undefined)
              .map((s) => (
                <SessionRow key={s.id} t={t} s={s} now={now} onOpen={() => onOpen(s.id)} />
              ))}
          </section>
        ))}
    </>
  );
}

function SessionRow({ t, s, now, onOpen }: { t: Translate; s: SessionView; now: number; onOpen(): void }) {
  const tone = toneOf(s);
  const statusKey = tone === 'ended' ? 'status.ended' : (`status.${s.status}` as const);
  const tokens = s.tokens === undefined ? undefined : formatTokens(s.tokens.input + s.tokens.output);
  return (
    <div className={`srow tone-${tone}`}>
      <button type="button" className="srow-main" onClick={onOpen}>
        <span className={`dot tone-${tone}`} role="img" aria-label={t(statusKey)} title={t(statusKey)} />
        <span className="txt">
          <span className="l1">
            <span className="ttl">{sessionTitle(s, t)}</span>
            <span className="tm">{formatAge(now - (s.endedAt ?? s.lastEventAt), t)}</span>
          </span>
          <span className="l2">
            {sessionDetail(s)}
            {tokens !== undefined && <span className="tok"> · {tokens}</span>}
          </span>
        </span>
      </button>
    </div>
  );
}

function Usage({ t, snapshot, now }: { t: Translate; snapshot: Snapshot; now: number }) {
  const u = snapshot.usage;
  return (
    <section className="usage" aria-label={t('usage.title')}>
      {u === undefined ? (
        <span className="muted">{t('usage.none')}</span>
      ) : (
        <>
          {u.fiveHour !== undefined && <Gauge label={t('usage.fiveHour')} percent={u.fiveHour.percent} resets={u.fiveHour.resetsAt} t={t} now={now} />}
          {u.weekly !== undefined && <Gauge label={t('usage.weekly')} percent={u.weekly.percent} resets={u.weekly.resetsAt} t={t} now={now} />}
        </>
      )}
    </section>
  );
}

function Gauge({ label, percent, resets, t, now }: { label: string; percent: number; resets: number | undefined; t: Translate; now: number }) {
  const p = Math.max(0, Math.min(100, Math.round(percent)));
  const tone = p >= 85 ? 'wait' : 'run';
  return (
    <div className="gauge">
      <div className="g-l1">
        <span>{label}</span>
        <span className="mono">{p} %</span>
      </div>
      <div className="bar" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={p} aria-label={label}>
        <span className={`fill tone-${tone}`} style={{ width: `${p}%` }} />
      </div>
      {resets !== undefined && resets > now && <span className="g-l2">{t('usage.resets', { d: formatAge(resets - now, t) })}</span>}
    </div>
  );
}
