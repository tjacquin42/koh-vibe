import type { ActivityItemView, ActivitySessionView, SessionView } from '../../../src/shared/protocol';
import { formatAge, formatWhen, sessionDetail, sessionTitle, toneOf, type Tone } from '../format';
import type { Translate } from '../i18n';
import { boardColumns, folderIndex, hourTicks, inbox, SPANS_H, timelineLanes, type BoardColumns } from '../sections';
import { Dot, Icon, type IconName } from '../ui/icons';
import type { CockpitView, UiState } from '../ui-state';
import type { ViewCtx } from '../views/context';
import { FOLDER_COLORS } from '../ui/colors';
import { SessionSheet } from './Sheet';
import { menuContext } from '../ui/menu-context';
import { SessionName } from '../ui/SessionName';
import { Splitter } from '../ui/Splitter';
import { useFlip } from '../ui/flip';
import { useReorder } from '../ui/reorder';
import { EdgeScroll } from '../ui/EdgeScroll';
import { useRef, type CSSProperties, type ReactNode } from 'react';

type Cockpit = UiState['cockpit'];

/** Each remembered separator size, and the CSS variable that applies it (app.css). */
const SIZE_VARS = new Map<string, string>([
  ['ck.side.w', '--side-w'],
  ['ck.side.h', '--side-h'],
]);

/**
 * W2: the cockpit in an editor tab (14/11): the folders, the counters and the
 * views across the top (CockpitTop, CockpitTabs), then the chosen view, and
 * what waits for you on the right — under it on a narrow screen.
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
  const { t } = ctx;
  const box = useRef<HTMLDivElement>(null);
  const side = useRef<HTMLElement>(null);
  // Which handles show depends on the width (app.css): side by side they size
  // widths, stacked they size heights — each remembered on its own.
  const vars: Record<string, string> = {};
  for (const [key, cssVar] of SIZE_VARS) {
    const px = sizes[key];
    if (px !== undefined) vars[cssVar] = `${px}px`;
  }
  const split = (key: string, axis: 'x' | 'y', target: typeof side, invert: boolean) => (
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
      <main className="ck-main">
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
      </aside>
    </div>
  );
}

/**
 * The views, across the whole width under the counters (14/11), named in
 * English in every language — Board, Wall, Feed, Timeline. A sheet open under
 * them closes on a click.
 */
export function CockpitTabs({
  ctx,
  view,
  order,
  sheet,
  onView,
  onOrder,
}: {
  ctx: ViewCtx;
  view: CockpitView;
  order: readonly CockpitView[];
  sheet: string | undefined;
  onView(v: CockpitView): void;
  onOrder(order: CockpitView[]): void;
}) {
  const { t } = ctx;
  const nav = useRef<HTMLElement>(null);
  useFlip(nav, ctx.animate);
  // Dragged into the order wanted, as the sidebar's tabs (ui/reorder.ts).
  const { shown, itemProps, barProps } = useReorder(order, onOrder);
  return (
    <nav ref={nav} className="ck-tabs" role="tablist" aria-label={t('cockpit.views')} {...barProps}>
      {shown.map((v) => (
        <button key={v} type="button" role="tab" data-flip={`view:${v}`} aria-selected={view === v && sheet === undefined} onClick={() => onView(v)} {...itemProps(v)}>
          <Icon name={VIEW_ICON[v]} size={16} />
          <span>{t(`cockpit.view.${v}`)}</span>
        </button>
      ))}
    </nav>
  );
}

const VIEW_ICON: Record<CockpitView, IconName> = { board: 'columns', wall: 'grid', feed: 'list', timeline: 'clock' };

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
  }
}

/**
 * The top of the cockpit (14/11): the folders side by side — ∞ for every
 * conversation — and the counters of the one chosen, named in English.
 */
export function CockpitTop({ ctx, folder, onFolder }: { ctx: ViewCtx; folder: string | null; onFolder(v: string | null): void }) {
  const { t, snapshot } = ctx;
  const where = folderIndex(snapshot);
  const counts = { waiting: 0, running: 0, done: 0 };
  for (const s of snapshot.sessions) {
    if (s.endedAt !== undefined || (folder !== null && where.get(s.id) !== folder)) continue;
    if (s.status === 'waiting') counts.waiting++;
    else if (s.status === 'running') counts.running++;
    else if (s.status === 'done_unseen') counts.done++;
  }
  const chip = (id: string | null, body: ReactNode, label?: string) => (
    <button key={id ?? 'all'} type="button" role="radio" aria-checked={folder === id} aria-label={label} className="fchip" onClick={() => onFolder(id)}>
      {body}
    </button>
  );
  return (
    <div className="ck-top">
      <EdgeScroll className="fchips" label={t('cockpit.folders')}>
        {chip(null, <Icon name="infinity" size={16} />, t('cockpit.allFolders'))}
        {snapshot.folders.map((f) =>
          chip(
            f.id,
            <>
              <span className="fold" style={{ background: (f.color !== undefined ? FOLDER_COLORS[f.color] : undefined) ?? 'var(--line)' }} />
              {f.name}
            </>,
          ),
        )}
        {chip(
          'unfiled',
          <>
            <Icon name="hourglass" />
            {t('folder.temporary')}
          </>,
        )}
      </EdgeScroll>
      <div className="counts">
        <CountBox n={counts.waiting} label={t('cockpit.count.waiting')} tone="wait" />
        <CountBox n={counts.running} label={t('cockpit.count.running')} tone="run" />
        <CountBox n={counts.done} label={t('cockpit.count.done')} tone="done" />
      </div>
    </div>
  );
}

function CountBox({ n, label, tone }: { n: number; label: string; tone: string }) {
  return (
    <div className={`count tone-${tone}`}>
      <b>{n}</b>
      <span>{label}</span>
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

/* ---------- small parts ---------- */

export function Segmented<T extends string | number>({ label, options, value, onChange }: { label: string; options: { value: T; label: string }[]; value: T; onChange(v: T): void }) {
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
