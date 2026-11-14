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
import type { Translate } from './i18n';

/** How many unpinned artifacts « Recent » shows; the rest are under their project. */
export const RECENT_COUNT = 8;

export interface ArtifactSections {
  pinned: ArtifactView[];
  recent: ArtifactView[];
  /** By project name, A→Z; « Other » (`undefined`) last. */
  projects: { project: string | undefined; items: ArtifactView[] }[];
}

/** The items arrive sorted by the host (pinned first, then most recent). */
export function artifactSections(items: readonly ArtifactView[]): ArtifactSections {
  const pinned = items.filter((a) => a.pinned);
  const recent = items.filter((a) => !a.pinned).slice(0, RECENT_COUNT);
  const byProject = new Map<string | undefined, ArtifactView[]>();
  for (const a of items) byProject.set(a.project, [...(byProject.get(a.project) ?? []), a]);
  const named = [...byProject.entries()]
    .filter((e): e is [string, ArtifactView[]] => e[0] !== undefined)
    .sort(([a], [b]) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true }))
    .map(([project, list]) => ({ project, items: list }));
  const other = byProject.get(undefined);
  return { pinned, recent, projects: other === undefined ? named : [...named, { project: undefined, items: other }] };
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

export function usageLines(u: UsageView, t: Translate): Line[] {
  const lines: Line[] = [];
  if (u.fiveHour !== undefined) lines.push({ key: '5h', label: t('usage.fiveHour'), w: u.fiveHour });
  if (u.weekly !== undefined) lines.push({ key: '7d', label: t('usage.weekly'), w: u.weekly });
  for (const m of u.models) lines.push({ key: `m:${m.name}`, label: t('usage.model', { name: m.name }), w: m });
  return lines;
}


/* ---------- cockpit ---------- */

/** Every listed conversation's folder id; « unfiled » for the temporary ones. */
export function folderIndex(snap: Snapshot): Map<string, string> {
  const out = new Map<string, string>();
  for (const f of snap.folders) for (const id of f.sessionIds) out.set(id, f.id);
  for (const id of snap.unfiled) out.set(id, 'unfiled');
  return out;
}

export interface BoardColumns {
  wait: SessionView[];
  run: SessionView[];
  done: SessionView[];
  /** Idle, and ended last. */
  rest: SessionView[];
}

/** A: one column per status, filtered to a folder when one is chosen. */
export function boardColumns(snap: Snapshot, folder: string | undefined): BoardColumns {
  const where = folderIndex(snap);
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

/**
 * C: what is waiting for you — the longest-waiting first, since it has
 * waited longest — then what finished and was not read yet.
 */
export function inbox(snap: Snapshot): { waiting: SessionView[]; toRead: SessionView[] } {
  const open = snap.sessions.filter((s) => s.endedAt === undefined);
  return {
    waiting: open.filter((s) => s.status === 'waiting').sort((a, b) => a.lastEventAt - b.lastEventAt),
    toRead: open.filter((s) => s.status === 'done_unseen').sort((a, b) => b.lastEventAt - a.lastEventAt),
  };
}

export type CountMode = 'fresh' | 'all' | 'weighted';
export const COUNT_MODES: readonly CountMode[] = ['fresh', 'all', 'weighted'];

/**
 * H's three ways of counting, decided in the triage:
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

export interface ProjectTotal {
  project: string;
  own: number;
  subagents: number;
  total: number;
  sessions: number;
}

/** H: per project, subagents included, biggest first. */
export function projectTotals(activity: ActivityView, mode: CountMode): ProjectTotal[] {
  const by = new Map<string, ProjectTotal>();
  for (const s of activity.sessions) {
    const p = by.get(s.project) ?? { project: s.project, own: 0, subagents: 0, total: 0, sessions: 0 };
    p.own += countTokens(s.tokens, mode);
    p.subagents += countTokens(s.subagentTokens, mode);
    p.total = p.own + p.subagents;
    p.sessions++;
    by.set(s.project, p);
  }
  return [...by.values()].filter((p) => p.total > 0).sort((a, b) => b.total - a.total);
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
