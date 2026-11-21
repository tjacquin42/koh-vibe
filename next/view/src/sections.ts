/**
 * How each tab cuts its list into sections — pure, so it is tested without
 * rendering anything.
 */
import type {
  ActivitySessionView,
  ActivityView,
  ArtifactView,
  RoutineGroup,
  RoutineView,
  SessionView,
  Snapshot,
  TokenCount,
  UsageView,
  UsageWindowView,
} from '../../src/shared/protocol';
import { folderIndex, UNFILED } from './format';
import { moveBefore } from './order';
import type { Translate } from './i18n';

/** How many unpinned artifacts « Recent » shows; the rest are under their project. */
export const RECENT_COUNT = 8;

export interface ArtifactSections {
  pinned: ArtifactView[];
  recent: ArtifactView[];
  /** In the order they were dragged into, then by name, A→Z; « Other » (`undefined`) last. */
  projects: { project: string | undefined; items: ArtifactView[] }[];
}

/**
 * The items arrive sorted by the host (pinned first, then most recent).
 * `folders`: the folders made by hand, which show among the projects even
 * while they hold nothing (16/11). `order`: the projects as they were dragged
 * (21/11) — one it does not name comes after, by name.
 */
export function artifactSections(items: readonly ArtifactView[], folders: readonly string[] = [], order: readonly string[] = []): ArtifactSections {
  const pinned = items.filter((a) => a.pinned);
  const recent = items.filter((a) => !a.pinned).slice(0, RECENT_COUNT);
  const byProject = new Map<string | undefined, ArtifactView[]>();
  for (const a of items) byProject.set(a.project, [...(byProject.get(a.project) ?? []), a]);
  for (const folder of folders) if (!byProject.has(folder)) byProject.set(folder, []);
  const named = [...byProject.entries()]
    .filter((e): e is [string, ArtifactView[]] => e[0] !== undefined)
    .sort(([a], [b]) => placeOf(order, a) - placeOf(order, b) || a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true }))
    .map(([project, list]) => ({ project, items: list }));
  const other = byProject.get(undefined);
  return { pinned, recent, projects: other === undefined ? named : [...named, { project: undefined, items: other }] };
}

/** Where a project stands in a dragged order: past the end when it is not in it. */
function placeOf(order: readonly string[], project: string): number {
  const i = order.indexOf(project);
  return i < 0 ? order.length : i;
}

/**
 * The projects' order once `name` is dropped on `target`'s `after` side — or,
 * with no `target` (« Other »), at the end of them.
 */
export function projectOrder(projects: readonly string[], name: string, target: string | undefined, after: boolean): string[] {
  if (target === undefined) return moveBefore(projects, name, undefined);
  const rest = projects.filter((p) => p !== name);
  const before = after ? rest[rest.indexOf(target) + 1] : target;
  return moveBefore(projects, name, before);
}

/**
 * Whether an artifact carried out of the project `from` moves when dropped on
 * `to` — `undefined` is « Other », the project of those that have none.
 * Dropped where it already is, there is nothing to write.
 */
export function dropsInto(from: string | undefined, to: string | undefined): boolean {
  return from !== to;
}

const ORDER: readonly RoutineGroup[] = ['today', 'tomorrow', 'week', 'later', 'paused'];

/** V1's order: by next run inside each group, by name among the paused. */
export function routineSections(items: readonly RoutineView[]): { group: RoutineGroup; items: RoutineView[] }[] {
  return ORDER.map((group) => {
    const list = items.filter((r) => r.group === group);
    list.sort(
      group === 'paused'
        ? (a, b) => a.name.localeCompare(b.name)
        : (a, b) => (a.nextRunAt ?? Number.POSITIVE_INFINITY) - (b.nextRunAt ?? Number.POSITIVE_INFINITY),
    );
    return { group, items: list };
  }).filter((s) => s.items.length > 0);
}

export interface Line {
  key: string;
  label: string;
  w: UsageWindowView;
}

/** How long each limit runs before it resets: five hours, else a week. */
export const FIVE_HOURS_MS = 5 * 3_600_000;
export const WEEK_MS = 7 * 24 * 3_600_000;

/**
 * Where the use should be at most by now, for a limit to last until it
 * resets (15/11): the share of its window already gone. Reset in 2.5 hours
 * on a 5-hour limit → 50 %. `undefined` without a reset to go by.
 */
export function pacePercent(resetsAt: number | undefined, span: number, now: number): number | undefined {
  if (resetsAt === undefined || resetsAt <= now) return undefined;
  return Math.min(100, Math.max(0, (1 - (resetsAt - now) / span) * 100));
}

export function usageLines(u: UsageView, t: Translate): Line[] {
  const lines: Line[] = [];
  if (u.fiveHour !== undefined) lines.push({ key: '5h', label: t('usage.fiveHour'), w: u.fiveHour });
  if (u.weekly !== undefined) lines.push({ key: '7d', label: t('usage.weekly'), w: u.weekly });
  for (const m of u.models) lines.push({ key: `m:${m.name}`, label: t('usage.model', { name: m.name }), w: m });
  return lines;
}


/** A limit as its bar shows it: the whole percentage, its colour, and when it resets if that is still ahead. */
export function gaugeOf(w: UsageWindowView, now: number): { percent: number; tone: 'wait' | 'run'; resetsAt: number | undefined } {
  const percent = Math.max(0, Math.min(100, Math.round(w.percent)));
  return { percent, tone: percent >= 85 ? 'wait' : 'run', resetsAt: w.resetsAt !== undefined && w.resetsAt > now ? w.resetsAt : undefined };
}

/* ---------- cockpit ---------- */

export interface BoardColumns {
  wait: SessionView[];
  run: SessionView[];
  done: SessionView[];
  /** Idle, and ended last. */
  rest: SessionView[];
}

/** A: one column per status, filtered to a folder when one is chosen. */
export function boardColumns(snap: Snapshot, folder: string | undefined, where: ReadonlyMap<string, string> = folderIndex(snap)): BoardColumns {
  const cols: BoardColumns = { wait: [], run: [], done: [], rest: [] };
  for (const s of snap.sessions) {
    if (folder !== undefined && where.get(s.id) !== folder) continue;
    if (s.endedAt !== undefined || s.status === 'idle') cols.rest.push(s);
    else if (s.status === 'waiting') cols.wait.push(s);
    else if (s.status === 'running') cols.run.push(s);
    else cols.done.push(s);
  }
  return cols;
}

/** The open conversations a count counts — waiting, working, finished — the latest on top, as notifications are (21/11). */
export type PeekTone = 'wait' | 'run' | 'done';
const PEEK_STATUS = { wait: 'waiting', run: 'running', done: 'done_unseen' } as const;
export function inTone(sessions: readonly SessionView[], tone: PeekTone): SessionView[] {
  return sessions.filter((s) => s.endedAt === undefined && s.status === PEEK_STATUS[tone]).sort((a, b) => b.lastEventAt - a.lastEventAt);
}

export type CountMode = 'fresh' | 'all' | 'weighted';

/**
 * Three ways of counting tokens, decided in the triage (the sheet uses two):
 *  - fresh: what the model processed for the first time — input, output and
 *    what was written to the cache (new input, billed as such);
 *  - all: fresh plus what was read back from the cache — the real volume;
 *  - weighted: fresh plus a tenth of the cache reads, about what they cost.
 */
export function countTokens(t: TokenCount, mode: CountMode): number {
  const fresh = t.input + t.output + t.cacheWrite;
  if (mode === 'fresh') return fresh;
  return fresh + (mode === 'all' ? t.cacheRead : t.cacheRead * 0.1);
}

export const SPANS_H: readonly number[] = [4, 8, 24];

export interface Lane {
  session: ActivitySessionView;
  /** Stretches as fractions of the span, [left, width], 0–1. */
  bars: [number, number][];
}

/** G: one lane per conversation active within the span, most recent first. */
export function timelineLanes(activity: ActivityView, now: number, spanMs: number): Lane[] {
  const from = now - spanMs;
  const lanes: Lane[] = [];
  for (const s of activity.sessions) {
    const bars: [number, number][] = [];
    for (const [a, b] of s.busy) {
      const start = Math.max(a, from);
      const end = Math.min(b, now);
      if (end <= start) continue;
      bars.push([(start - from) / spanMs, Math.max((end - start) / spanMs, 0.002)]);
    }
    if (bars.length > 0) lanes.push({ session: s, bars });
  }
  return lanes;
}

/** Whole hours inside the span, as [fraction, epoch ms] — the timeline's ticks. */
export function hourTicks(now: number, spanMs: number, everyH: number): [number, number][] {
  const from = now - spanMs;
  const first = new Date(from);
  first.setMinutes(0, 0, 0);
  let t = first.getTime() + 3_600_000;
  const out: [number, number][] = [];
  for (; t < now; t += 3_600_000) {
    if (new Date(t).getHours() % everyH !== 0) continue;
    out.push([(t - from) / spanMs, t]);
  }
  return out;
}

/**
 * A list's order once `moved` is dropped in front of `before` — or at the end
 * when `before` is absent, unknown, or one of the moved ids itself (a drop on
 * itself must still land somewhere sensible, never vanish).
 */
export function dropOrder(list: readonly string[], moved: readonly string[], before?: string): string[] {
  const moving = new Set(moved);
  const rest = list.filter((id) => !moving.has(id));
  const at = before === undefined || moving.has(before) ? -1 : rest.indexOf(before);
  const cut = at < 0 ? rest.length : at;
  return [...rest.slice(0, cut), ...moved, ...rest.slice(cut)];
}

/** How a folder's conversations are ordered (14/11 — the triage's open request). */
export const SESSION_SORTS = ['manual', 'recent', 'status'] as const;
export type SessionSort = (typeof SESSION_SORTS)[number];

/** What waits for you first, then what works, then what finished unread, then the rest. */
const STATUS_RANK: Record<SessionView['status'], number> = { waiting: 0, running: 1, done_unseen: 2, idle: 3 };

/**
 * A folder's conversations in the order picked: `manual` keeps the order the
 * list arrives in (dragged by hand, else the host's), `recent` puts the last
 * active first, `status` what needs you first — the most recent first within
 * a status, but the working ones, which keep their order. Stable, never in place.
 */
export function sortSessions(list: readonly SessionView[], sort: SessionSort): SessionView[] {
  if (sort === 'manual') return [...list];
  const byRecent = (a: SessionView, b: SessionView): number => b.lastEventAt - a.lastEventAt;
  if (sort === 'recent') return [...list].sort(byRecent);
  // The ones working keep their order among themselves (15/11): each new
  // action of one made it climb over the others, and the list never stood still.
  return [...list].sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || (a.status === 'running' ? 0 : byRecent(a, b)));
}

/** The title Claude Code gives a conversation that has none yet. */
const UNTITLED_TAB = 'Claude Code';

/**
 * The conversation whose tab is in front (host active-tab.ts): the one the
 * editor's memento names; else the one open conversation of that title; else,
 * for a tab still untitled, the newest conversation with nothing written yet —
 * the one just opened. Nothing when it cannot be told: marking the wrong row
 * is worse than marking none.
 */
export function activeSessionId(snap: Snapshot): string | undefined {
  const a = snap.activeTab;
  if (a === undefined) return undefined;
  const open = snap.sessions.filter((s) => s.endedAt === undefined);
  if (a.sessionId !== undefined && snap.sessions.some((s) => s.id === a.sessionId)) return a.sessionId;
  const titled = open.filter((s) => s.title === a.label);
  if (titled.length === 1) return titled[0]?.id;
  if (a.label !== UNTITLED_TAB) return undefined;
  const fresh = open.filter((s) => s.fresh === true).sort((x, y) => y.lastEventAt - x.lastEventAt);
  return fresh[0]?.id;
}


/**
 * Whether the list brings the conversation in front into sight
 * (views/Sessions.tsx), given the key of the last time it did (`prev`): once
 * per conversation — and again when it leaves « no folder » for a folder. A
 * new conversation asked for in a folder shows up first in none, at the
 * bottom, then moves to its folder (21/11): while one is on its way
 * (`newInFolder`), a conversation in no folder waits, and the list goes
 * straight to the folder. One moved by hand from a folder to another stays
 * where the hand put it.
 */
export function revealStep(prev: string | undefined, active: string, folder: string | undefined, newInFolder: boolean): { key: string; reveal: boolean } | undefined {
  const unfiled = folder === undefined || folder === UNFILED;
  if (unfiled && newInFolder) return undefined;
  const key = `${active}\n${unfiled ? '' : folder}`;
  if (key === prev) return undefined;
  const wasFiled = prev !== undefined && prev.startsWith(`${active}\n`) && !prev.endsWith('\n');
  return { key, reveal: !wasFiled };
}
