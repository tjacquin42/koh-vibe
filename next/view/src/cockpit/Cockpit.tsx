import type { ActivityItemView, ActivitySessionView, SessionView, Snapshot } from '../../../src/shared/protocol';
import { formatAge, formatTokens, formatWhen, sessionDetail, sessionTitle, toneOf, type Tone } from '../format';
import type { Translate } from '../i18n';
import {
  boardColumns,
  COUNT_MODES,
  hourTicks,
  inbox,
  projectTotals,
  SPANS_H,
  timelineLanes,
  usageLines,
  type BoardColumns,
} from '../sections';
import { Dot, Icon, type IconName } from '../ui/icons';
import { COCKPIT_VIEWS, type CockpitView, type UiState } from '../ui-state';
import type { ViewCtx } from '../views/context';
import { FOLDER_COLORS } from '../ui/colors';
import { SessionSheet } from './Sheet';
import { menuContext } from '../ui/menu-context';
import { SessionName } from '../ui/SessionName';
import { Splitter } from '../ui/Splitter';
import { useRef, type CSSProperties } from 'react';

type Cockpit = UiState['cockpit'];

/** Each remembered separator size, and the CSS variable that applies it (app.css). */
const SIZE_VARS = new Map<string, string>([
  ['ck.nav.w', '--nav-w'],
  ['ck.nav.h', '--nav-h'],
  ['ck.side.w', '--side-w'],
  ['ck.side.h', '--side-h'],
]);

/**
 * W2: the cockpit in an editor tab, on three columns — the views and the
 * folders on the left, the chosen view in the middle, what waits for you on
 * the right. Below a laptop's half-screen it folds into one column.
 */
export function CockpitBody({
  ctx,
  ui,
  setUi,
  sheet,
  onSheet,
  sizes,
  onSize,
}: {
  ctx: ViewCtx;
  ui: Cockpit;
  setUi(next: Partial<Cockpit>): void;
  /** The conversation whose sheet takes the middle column, if any. */
  sheet: string | undefined;
  onSheet(id: string | undefined): void;
  /** Separator sizes the user dragged (ui-state.ts `sizes`), and where to remember a new one. */
  sizes: Readonly<Record<string, number>>;
  onSize(key: string, px: number | undefined): void;
}) {
  const { t, snapshot } = ctx;
  const box = useRef<HTMLDivElement>(null);
  const nav = useRef<HTMLElement>(null);
  const side = useRef<HTMLElement>(null);
  // Which handles show depends on the width (app.css): side by side they size
  // widths, stacked they size heights — each remembered on its own.
  const vars: Record<string, string> = {};
  for (const [key, cssVar] of SIZE_VARS) {
    const px = sizes[key];
    if (px !== undefined) vars[cssVar] = `${px}px`;
  }
  const split = (key: string, axis: 'x' | 'y', target: typeof nav, invert: boolean) => (
    <Splitter
      axis={axis}
      target={target}
      container={box}
      cssVar={SIZE_VARS.get(key) ?? ''}
      invert={invert}
      min={axis === 'x' ? 150 : 80}
      max={axis === 'x' ? 640 : 900}
      label={t('cockpit.resize')}
      className={`sp-${key.replace('ck.', '').replace('.', '-')}`}
      onCommit={(px) => onSize(key, px)}
    />
  );
  return (
    <div className="cockpit" ref={box} style={vars as CSSProperties}>
      <nav className="ck-nav" ref={nav} aria-label={t('cockpit.folders')}>
        <h2 className="sec sec-label">{t('cockpit.folders')}</h2>
        <FolderFilter ctx={ctx} value={ui.folder} onChange={(folder) => setUi({ folder })} />
      </nav>
      {split('ck.nav.w', 'x', nav, false)}
      {split('ck.nav.h', 'y', nav, false)}
      <main className="ck-main">
        {/* The views as tabs, on top of what they show (14/11): a sheet open under them closes on a click. */}
        <nav className="ck-tabs" role="tablist" aria-label={t('cockpit.views')}>
          {COCKPIT_VIEWS.map((v) => (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={ui.view === v && sheet === undefined}
              onClick={() => {
                onSheet(undefined);
                setUi({ view: v });
              }}
            >
              <Icon name={VIEW_ICON[v]} />
              <span>{t(`cockpit.view.${v}`)}</span>
            </button>
          ))}
        </nav>
        {sheet !== undefined ? (
          <SessionSheet ctx={ctx} id={sheet} onClose={() => onSheet(undefined)} />
        ) : (
          <>
            <ViewBody ctx={ctx} ui={ui} setUi={setUi} />
          </>
        )}
      </main>
      {split('ck.side.w', 'x', side, true)}
      {split('ck.side.h', 'y', side, true)}
      <aside className="ck-side" ref={side}>
        <Inbox ctx={ctx} />
        <h2 className="sec">{t('usage.title')}</h2>
        <div className="meters">
          {snapshot.usage === undefined ? (
            <p className="hint">{t('usage.none')}</p>
          ) : (
            usageLines(snapshot.usage, t).map((l) => <MiniGauge key={l.key} label={l.label} percent={l.w.percent} />)
          )}
        </div>
      </aside>
    </div>
  );
}

const VIEW_ICON: Record<CockpitView, IconName> = { board: 'columns', wall: 'grid', feed: 'list', timeline: 'clock', usage: 'bars' };

function ViewBody({ ctx, ui, setUi }: { ctx: ViewCtx; ui: Cockpit; setUi(next: Partial<Cockpit>): void }) {
  switch (ui.view) {
    case 'board':
      return <Board ctx={ctx} cols={boardColumns(ctx.snapshot, ui.folder ?? undefined)} />;
    case 'wall':
      return <Wall ctx={ctx} folder={ui.folder} />;
    case 'feed':
      return <Feed ctx={ctx} folder={ui.folder} />;
    case 'timeline':
      return <Timeline ctx={ctx} folder={ui.folder} spanH={ui.spanH} onSpan={(spanH) => setUi({ spanH })} />;
    case 'usage':
      return <UsageDetail ctx={ctx} count={ui.count} onCount={(count) => setUi({ count })} />;
  }
}

function FolderFilter({ ctx, value, onChange }: { ctx: ViewCtx; value: string | null; onChange(v: string | null): void }) {
  const { t, snapshot } = ctx;
  const options: { id: string | null; name: string; color?: string }[] = [
    { id: null, name: t('cockpit.allFolders') },
    ...snapshot.folders.map((f) => (f.color === undefined ? { id: f.id, name: f.name } : { id: f.id, name: f.name, color: f.color })),
    { id: 'unfiled', name: t('folder.temporary') },
  ];
  return (
    <div className="chips" role="radiogroup" aria-label={t('cockpit.folders')}>
      {options.map((o) => (
        <button key={o.id ?? 'all'} type="button" role="radio" aria-checked={value === o.id} className="chip" onClick={() => onChange(o.id)}>
          {o.id !== null && <span className="fold" style={{ background: (o.color !== undefined ? FOLDER_COLORS[o.color] : undefined) ?? 'var(--line)' }} />}
          {o.name}
        </button>
      ))}
    </div>
  );
}

/* ---------- A. Board ---------- */

const COLUMNS: { key: keyof BoardColumns; tone: Tone; label: 'board.wait' | 'board.run' | 'board.done' | 'board.rest' }[] = [
  { key: 'wait', tone: 'wait', label: 'board.wait' },
  { key: 'run', tone: 'run', label: 'board.run' },
  { key: 'done', tone: 'done', label: 'board.done' },
  { key: 'rest', tone: 'idle', label: 'board.rest' },
];

function Board({ ctx, cols }: { ctx: ViewCtx; cols: BoardColumns }) {
  const { t } = ctx;
  return (
    <div className="board">
      {COLUMNS.map((c) => (
        <section key={c.key} className="col" aria-label={t(c.label)}>
          <h2 className="col-h">
            <Dot tone={c.tone} animate={ctx.animate} size={14} />
            {t(c.label)} <span className="n">{cols[c.key].length}</span>
          </h2>
          {cols[c.key].length === 0 && <p className="hint">{t('board.empty')}</p>}
          {cols[c.key].map((s) => (
            <SessionCard key={s.id} ctx={ctx} s={s} />
          ))}
        </section>
      ))}
    </div>
  );
}

function SessionCard({ ctx, s }: { ctx: ViewCtx; s: SessionView }) {
  const { t, now } = ctx;
  return (
    <button type="button" className={`bcard tone-${toneOf(s)}`} onClick={() => ctx.show(s.id)} data-vscode-context={menuContext('kvnSession', { kvnSessionId: s.id, kvnEnded: s.endedAt !== undefined })}>
      <span className="l1">
        <span className="ttl">
          <SessionName s={s} t={t} animate={ctx.animate} />
        </span>
        <span className="tm">{formatAge(now - (s.endedAt ?? s.lastEventAt), t)}</span>
      </span>
      <span className="l2">{sessionDetail(s)}</span>
    </button>
  );
}

/* ---------- C. For you ---------- */

export function Inbox({ ctx, compact = false }: { ctx: ViewCtx; compact?: boolean }) {
  const { t, now } = ctx;
  const all = inbox(ctx.snapshot);
  // A card closed with its × stays closed until the conversation moves again.
  const box = { ...all, waiting: all.waiting.filter((s) => !ctx.isDismissed(s.id, s.lastEventAt)) };
  if (compact && box.waiting.length === 0) return null;
  return (
    <section className="inbox" aria-label={t('inbox.title')}>
      <h2 className="sec">
        {t('inbox.title')} <span className="n">{box.waiting.length}</span>
      </h2>
      {box.waiting.length === 0 && <p className="hint">{t('inbox.none')}</p>}
      {box.waiting.map((s) => (
        <div key={s.id} className="ask">
          <div className="ask-h">
            <Dot tone="wait" animate={false} />
            <span className="txt">
              <span className="ttl">
          <SessionName s={s} t={t} animate={ctx.animate} />
        </span>
              <span className="muted small">{now - s.lastEventAt < 60_000 ? t('inbox.justNow') : t('inbox.since', { d: formatAge(now - s.lastEventAt, t) })}</span>
            </span>
            <button type="button" className="tbtn ask-x" aria-label={t('inbox.dismiss')} onClick={() => ctx.dismiss(s.id, s.lastEventAt)}>
              <Icon name="close" />
            </button>
          </div>
          {s.pendingPermission !== undefined && (
            <span className="q mono">
              <b>{s.pendingPermission.tool}</b> {s.pendingPermission.summary}
            </span>
          )}
          <button type="button" className="btn primary" onClick={() => ctx.bridge.post({ type: 'openSession', sessionId: s.id })}>
            {t('inbox.answer')}
          </button>
        </div>
      ))}
      {!compact && box.waiting.length > 0 && <p className="hint">{t('inbox.never')}</p>}
      {!compact && box.toRead.length > 0 && (
        <>
          <h2 className="sec">
            {t('inbox.toRead')} <span className="n">{box.toRead.length}</span>
          </h2>
          {box.toRead.map((s) => (
            <button key={s.id} type="button" className="row row-btn" onClick={() => ctx.bridge.post({ type: 'openSession', sessionId: s.id })}>
              <Dot tone="done" animate={false} />
              <span className="ttl">
          <SessionName s={s} t={t} animate={ctx.animate} />
        </span>
              <span className="tm">{formatAge(now - s.lastEventAt, t)}</span>
            </button>
          ))}
        </>
      )}
    </section>
  );
}

/* ---------- activity views ---------- */

function activityOf(ctx: ViewCtx, folder: string | null): { sessions: ActivitySessionView[]; listed: Map<string, SessionView>; filed: (id: string) => boolean } | undefined {
  const a = ctx.snapshot.activity;
  if (a === undefined) return undefined;
  const listed = new Map(ctx.snapshot.sessions.map((s) => [s.id, s]));
  const where = new Map<string, string>();
  for (const f of ctx.snapshot.folders) for (const id of f.sessionIds) where.set(id, f.id);
  for (const id of ctx.snapshot.unfiled) where.set(id, 'unfiled');
  // A conversation no longer on the list belongs to no folder: shown only unfiltered.
  const filed = (id: string): boolean => folder === null || where.get(id) === folder;
  return { sessions: a.sessions.filter((s) => filed(s.id)), listed, filed };
}

function Loading({ t }: { t: Translate }) {
  return <p className="hint pad">{t('cockpit.loading')}</p>;
}

function toneFor(id: string, listed: Map<string, SessionView>): Tone {
  const s = listed.get(id);
  return s === undefined ? 'ended' : toneOf(s);
}

const KIND_ICON: Record<ActivityItemView['kind'], IconName> = { prompt: 'user', text: 'chat', tool: 'gear' };

function ItemLine({ ctx, i, withTime }: { ctx: ViewCtx; i: ActivityItemView; withTime: boolean }) {
  const { t, language } = ctx;
  return (
    <span className={`it it-${i.kind}${i.subagent ? ' it-sub' : ''}`}>
      {withTime && <span className="at">{formatWhen(i.at, i.at, language)}</span>}
      <span className="ik" role="img" aria-label={i.kind === 'tool' ? (i.tool ?? '') : t(`feed.${i.kind}`)}>
        <Icon name={i.subagent ? 'bot' : KIND_ICON[i.kind]} size={12} />
      </span>
      {i.kind === 'tool' && <b className="tn">{i.tool}</b>}
      <span className="tx">{i.text}</span>
    </span>
  );
}

/* B. Wall */
function Wall({ ctx, folder }: { ctx: ViewCtx; folder: string | null }) {
  const { t, now } = ctx;
  const a = activityOf(ctx, folder);
  if (a === undefined) return <Loading t={t} />;
  if (a.sessions.length === 0) return <p className="hint pad">{t('wall.empty')}</p>;
  return (
    <div className="wall">
      {a.sessions.map((s) => {
        const listed = a.listed.get(s.id);
        return (
          <button
            key={s.id}
            type="button"
            className="tile"
            onClick={() => ctx.show(s.id)}
            data-vscode-context={menuContext('kvnSession', { kvnSessionId: s.id, kvnEnded: listed?.endedAt !== undefined })}
          >
            <span className="tile-h">
              <Dot tone={toneFor(s.id, a.listed)} animate={ctx.animate} />
              <span className="ttl">{listed !== undefined ? <SessionName s={listed} t={t} animate={ctx.animate} /> : (s.title ?? s.project)}</span>
              <span className="tm">{formatAge(now - s.lastAt, t)}</span>
            </span>
            <span className="muted small">
              {s.project}
              {s.subagents > 0 && ` · ${s.subagents} ${t('feed.subagent')}${s.subagents > 1 ? 's' : ''}`}
            </span>
            <span className="tile-b">
              {s.tail.length === 0 && <span className="muted">{t('wall.quiet')}</span>}
              {s.tail.map((i, k) => (
                <ItemLine key={k} ctx={ctx} i={i} withTime={false} />
              ))}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/* D. Feed */
function Feed({ ctx, folder }: { ctx: ViewCtx; folder: string | null }) {
  const { t } = ctx;
  const a = activityOf(ctx, folder);
  const feed = ctx.snapshot.activity?.feed;
  if (a === undefined || feed === undefined) return <Loading t={t} />;
  const items = feed.filter((i) => a.filed(i.sessionId));
  if (items.length === 0) return <p className="hint pad">{t('feed.empty')}</p>;
  const titles = new Map(ctx.snapshot.activity?.sessions.map((s) => [s.id, s.title ?? s.project]));
  for (const s of ctx.snapshot.sessions) titles.set(s.id, sessionTitle(s, t));
  return (
    <ol className="feed">
      {items.map((i, k) => (
        <li key={`${i.at}-${k}`}>
          <button type="button" className="feed-row" onClick={() => ctx.show(i.sessionId)}>
            <Dot tone={toneFor(i.sessionId, a.listed)} animate={false} size={12} />
            <span className="who">{titles.get(i.sessionId) ?? i.sessionId}</span>
            <ItemLine ctx={ctx} i={i} withTime />
          </button>
        </li>
      ))}
    </ol>
  );
}

/* G. Timeline */
function Timeline({ ctx, folder, spanH, onSpan }: { ctx: ViewCtx; folder: string | null; spanH: number; onSpan(h: number): void }) {
  const { t, now, language } = ctx;
  const a = activityOf(ctx, folder);
  const activity = ctx.snapshot.activity;
  if (a === undefined || activity === undefined) return <Loading t={t} />;
  const span = spanH * 3_600_000;
  const lanes = timelineLanes({ ...activity, sessions: a.sessions }, now, span);
  const ticks = hourTicks(now, span, spanH > 8 ? 3 : 1);
  return (
    <>
      <Segmented
        label={t('timeline.span')}
        options={SPANS_H.map((h) => ({ value: h, label: t('timeline.hours', { n: h }) }))}
        value={spanH}
        onChange={onSpan}
      />
      {lanes.length === 0 ? (
        <p className="hint pad">{t('timeline.empty')}</p>
      ) : (
        <div className="tl">
          <div className="tl-axis" aria-hidden="true">
            {/* A label too close to the right edge would sit on « now ». */}
            {ticks.filter(([x]) => x < 0.92).map(([x, at]) => (
              <span key={at} style={{ left: `${x * 100}%` }}>
                {formatWhen(at, at, language)}
              </span>
            ))}
            <span className="tl-now">{t('timeline.now')}</span>
          </div>
          {lanes.map((l) => {
            const listed = a.listed.get(l.session.id);
            const tone = toneFor(l.session.id, a.listed);
            return (
              <button key={l.session.id} type="button" className="tl-lane" onClick={() => ctx.show(l.session.id)}>
                <span className="tl-name">{listed !== undefined ? <SessionName s={listed} t={t} animate={ctx.animate} /> : (l.session.title ?? l.session.project)}</span>
                <span className="tl-track">
                  {ticks.map(([x, at]) => (
                    <i key={at} className="tl-grid" style={{ left: `${x * 100}%` }} />
                  ))}
                  {l.bars.map(([x, w], k) => (
                    <i key={k} className={`tl-bar tone-${tone}`} style={{ left: `${x * 100}%`, width: `${w * 100}%` }} />
                  ))}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </>
  );
}

/* H. Detailed usage */
function UsageDetail({ ctx, count, onCount }: { ctx: ViewCtx; count: Cockpit['count']; onCount(c: Cockpit['count']): void }) {
  const { t } = ctx;
  const activity = ctx.snapshot.activity;
  return (
    <>
      <h2 className="sec">{t('detail.byProject')}</h2>
      <Segmented label={t('detail.count')} options={COUNT_MODES.map((m) => ({ value: m, label: t(`detail.count.${m}`) }))} value={count} onChange={onCount} />
      <p className="hint">{t(`detail.hint.${count}`)}</p>
      {activity === undefined ? (
        <Loading t={t} />
      ) : (
        <ProjectBars t={t} snapshot={ctx.snapshot} count={count} />
      )}
      <p className="hint">{t('cockpit.window')}</p>
    </>
  );
}

function ProjectBars({ t, snapshot, count }: { t: Translate; snapshot: Snapshot; count: Cockpit['count'] }) {
  const activity = snapshot.activity;
  if (activity === undefined) return null;
  const rows = projectTotals(activity, count);
  if (rows.length === 0) return <p className="hint pad">{t('detail.none')}</p>;
  const max = rows[0]?.total ?? 1;
  const total = rows.reduce((n, r) => n + r.total, 0);
  return (
    <div className="bars">
      <div className="bars-total">
        {t('detail.total')} <b>{formatTokens(total)}</b>
        <span className="legend">
          <i className="sw own" /> {t('detail.own')} <i className="sw sub" /> {t('detail.sub')}
        </span>
      </div>
      {rows.map((r) => (
        <div key={r.project} className="b">
          <span className="b-name">
            {r.project}
            <span className="muted"> · {t('detail.sessions', { n: r.sessions })}</span>
          </span>
          <span className="b-track">
            <i className="own" style={{ width: `${(r.own / max) * 100}%` }} />
            <i className="sub" style={{ width: `${(r.subagents / max) * 100}%` }} />
          </span>
          <em>{formatTokens(r.total)}</em>
        </div>
      ))}
    </div>
  );
}

/* ---------- small parts ---------- */

function Segmented<T extends string | number>({ label, options, value, onChange }: { label: string; options: { value: T; label: string }[]; value: T; onChange(v: T): void }) {
  return (
    <div className="seg" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={String(o.value)} type="button" role="radio" aria-checked={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function MiniGauge({ label, percent }: { label: string; percent: number }) {
  const p = Math.max(0, Math.min(100, Math.round(percent)));
  return (
    <div className="gauge">
      <div className="g-l1">
        <span>{label}</span>
        <span className="mono">{p} %</span>
      </div>
      <div className="bar" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={p} aria-label={label}>
        <span className={`fill tone-${p >= 85 ? 'wait' : 'run'}`} style={{ width: `${p}%` }} />
      </div>
    </div>
  );
}
