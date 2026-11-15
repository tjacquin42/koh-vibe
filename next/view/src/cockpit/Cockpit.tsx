import type { ActivityItemView, ActivitySessionView, SessionView } from '../../../src/shared/protocol';
import { formatAge, formatWhen, isFiledIn, isQuietTool, sessionDetail, sessionTitle, type Tone, toneOf, toolLabel } from '../format';
import type { Translate } from '../i18n';
import { boardColumns, folderIndex, hourTicks, inbox, SPANS_H, timelineLanes, type BoardColumns } from '../sections';
import { Dot, Icon, type IconName } from '../ui/icons';
import type { CockpitView, UiState } from '../ui-state';
import type { ViewCtx } from '../views/context';
import { FOLDER_COLORS } from '../ui/colors';
import { SessionSheet } from './Sheet';
import { menuContext } from '../ui/menu-context';
import { SessionName } from '../ui/SessionName';
import { useFlip } from '../ui/flip';
import { useReorder } from '../ui/reorder';
import { useIconsOnly } from '../ui/fit';
import { EdgeScroll } from '../ui/EdgeScroll';
import { useRef, type ReactNode } from 'react';
import { UsageTab } from '../views/Usage';

type Cockpit = UiState['cockpit'];

/**
 * W2: the cockpit in an editor tab (14/11): the folders, the counters and the
 * views across the top (CockpitTop, CockpitTabs), then the chosen view,
 * across the whole width.
 */
export function CockpitBody({
  ctx,
  ui,
  setUi,
  sheet,
  onSheet,
}: {
  ctx: ViewCtx;
  ui: Cockpit;
  setUi(next: Partial<Cockpit>): void;
  /** The conversation whose sheet takes the cockpit, if any. */
  sheet: string | undefined;
  onSheet(id: string | undefined): void;
}) {
  // The whole width for the view (15/11): the side panel of what waits for
  // you is gone — the sidebar's « For you » already says it.
  return (
    <div className="cockpit">
      <main className="ck-main">
        {sheet !== undefined ? <SessionSheet ctx={ctx} id={sheet} onClose={() => onSheet(undefined)} /> : <ViewBody ctx={ctx} ui={ui} setUi={setUi} />}
      </main>
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
  // As the sidebar's tabs: names when they fit and the settings allow (ui/fit.ts).
  const iconsOnly = useIconsOnly(nav, true);
  return (
    <nav ref={nav} className={`ck-tabs${iconsOnly ? ' icons-only' : ''}`} role="tablist" aria-label={t('cockpit.views')} {...barProps}>
      {shown.map((v) => (
        <button
          key={v}
          type="button"
          role="tab"
          data-flip={`view:${v}`}
          aria-selected={view === v && sheet === undefined}
          aria-label={iconsOnly ? t(`cockpit.view.${v}`) : undefined}
          data-tip={iconsOnly ? t(`cockpit.view.${v}`) : undefined}
          onClick={() => onView(v)}
          {...itemProps(v)}
        >
          <Icon name={VIEW_ICON[v]} size={16} />
          {!iconsOnly && <span>{t(`cockpit.view.${v}`)}</span>}
        </button>
      ))}
    </nav>
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
      // The sidebar's Usage tab as it is: limits, pace marks, the hungriest conversations.
      return (
        <div className="ck-usage">
          <UsageTab ctx={ctx} />
        </div>
      );
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

const COLUMNS: { key: keyof BoardColumns; tone: Tone | 'rest'; label: 'board.wait' | 'board.run' | 'board.done' | 'board.rest' }[] = [
  { key: 'wait', tone: 'wait', label: 'board.wait' },
  { key: 'run', tone: 'run', label: 'board.run' },
  { key: 'done', tone: 'done', label: 'board.done' },
  { key: 'rest', tone: 'rest', label: 'board.rest' },
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
  // A click goes to the conversation; its sheet is the card's own button (15/11).
  return (
    <OpenCard ctx={ctx} id={s.id} className={`bcard tone-${toneOf(s)}`} context={menuContext('kvnSession', { kvnSessionId: s.id, kvnEnded: s.endedAt !== undefined, kvnFiled: isFiledIn(ctx.snapshot, s.id) })}>
      <span className="l1">
        <span className="ttl conv-ttl">
          <SessionName s={s} t={t} animate={ctx.animate} />
        </span>
        <span className="tm">{formatAge(now - (s.endedAt ?? s.lastEventAt), t)}</span>
      </span>
      <span className="l2">{sessionDetail(s)}</span>
    </OpenCard>
  );
}

/**
 * A conversation's card (15/11): a click, or Enter, goes to the conversation
 * and the card loads until its tab is in front; the sheet — the conversation's
 * details — is the card's own button, the index card, shown under the pointer.
 */
function OpenCard({ ctx, id, className, context, children }: { ctx: ViewCtx; id: string; className: string; context: string; children: ReactNode }) {
  const opening = ctx.reopening.has(id);
  return (
    <div
      className={`${className} open-card${opening ? ' opening' : ''}`}
      role="button"
      tabIndex={0}
      aria-busy={opening}
      data-vscode-context={context}
      onClick={() => ctx.open(id)}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget || (e.key !== 'Enter' && e.key !== ' ')) return;
        e.preventDefault();
        ctx.open(id);
      }}
    >
      {children}
      <button
        type="button"
        className="tbtn sheet-btn"
        aria-label={ctx.t('row.sheet')}
        onClick={(e) => {
          e.stopPropagation();
          ctx.show(id);
        }}
      >
        <Icon name="sheet" />
      </button>
    </div>
  );
}

/* ---------- C. For you ---------- */

/** To the conversation, from the sidebar or the cockpit alike; the card loads until it is in front. */
function goTo(ctx: ViewCtx, s: SessionView): void {
  ctx.open(s.id);
}

export function Inbox({ ctx }: { ctx: ViewCtx }) {
  const { t, now } = ctx;
  const all = inbox(ctx.snapshot);
  // A card closed with its × stays closed until the conversation moves again.
  const box = { ...all, waiting: all.waiting.filter((s) => !ctx.isDismissed(s.id, s.lastEventAt)) };
  if (box.waiting.length === 0) return null;
  return (
    <section className="inbox" aria-label={t('inbox.title')}>
      <h2 className="sec">
        {t('inbox.title')} <span className="n">{box.waiting.length}</span>
      </h2>
      {box.waiting.map((s) => (
        // The whole card goes to the conversation (15/11); the × only closes it.
        <div
          key={s.id}
          className={`ask ask-go${ctx.reopening.has(s.id) ? ' opening' : ''}`}
          role="button"
          tabIndex={0}
          onClick={() => goTo(ctx, s)}
          onKeyDown={(e) => {
            if (e.target !== e.currentTarget || (e.key !== 'Enter' && e.key !== ' ')) return;
            e.preventDefault();
            goTo(ctx, s);
          }}
        >
          <div className="ask-h">
            {/* It turns as it does in the list (15/11): the same conversation, the same wait. */}
            <Dot tone="wait" animate={ctx.animate} />
            <span className="txt">
              <span className="ttl conv-ttl">
                <SessionName s={s} t={t} animate={ctx.animate} />
              </span>
              <span className="muted small">{now - s.lastEventAt < 60_000 ? t('inbox.justNow') : t('inbox.since', { d: formatAge(now - s.lastEventAt, t) })}</span>
            </span>
            <button
              type="button"
              className="tbtn ask-x"
              aria-label={t('inbox.dismiss')}
              onClick={(e) => {
                e.stopPropagation();
                ctx.dismiss(s.id, s.lastEventAt);
              }}
            >
              <Icon name="close" />
            </button>
          </div>
          {/* What it waits on — but not a question's tool name, which says nothing the card does not (15/11). */}
          {s.pendingPermission !== undefined && !isQuietTool(s.pendingPermission.tool) && (
            <span className="q mono">
              <b>{toolLabel(s.pendingPermission.tool)}</b> {s.pendingPermission.summary}
            </span>
          )}
        </div>
      ))}
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
      <span className="ik" role="img" aria-label={i.kind === 'tool' ? toolLabel(i.tool ?? '') : t(`feed.${i.kind}`)}>
        <Icon name={i.subagent ? 'bot' : KIND_ICON[i.kind]} size={12} />
      </span>
      {i.kind === 'tool' && i.tool !== undefined && !isQuietTool(i.tool) && (
        <b className="tn" title={i.tool}>
          {toolLabel(i.tool)}
        </b>
      )}
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
          <OpenCard
            key={s.id}
            ctx={ctx}
            id={s.id}
            className="tile"
            context={menuContext('kvnSession', { kvnSessionId: s.id, kvnEnded: listed?.endedAt !== undefined, kvnFiled: isFiledIn(ctx.snapshot, s.id) })}
          >
            <span className="tile-h">
              <Dot tone={toneFor(s.id, a.listed)} animate={ctx.animate} />
              <span className="ttl conv-ttl">{listed !== undefined ? <SessionName s={listed} t={t} animate={ctx.animate} /> : (s.title ?? s.project)}</span>
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
          </OpenCard>
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
            <span className="feed-box">
              <ItemLine ctx={ctx} i={i} withTime />
            </span>
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

export function Segmented<T extends string | number>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  /** `disabled`: shown, greyed, not chosen — a place this editor cannot open (15/11). */
  options: { value: T; label: string; disabled?: boolean }[];
  value: T;
  onChange(v: T): void;
}) {
  return (
    <div className="seg" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={String(o.value)} type="button" role="radio" aria-checked={o.value === value} disabled={o.disabled === true} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
