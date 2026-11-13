/**
 * How each tab cuts its list into sections — pure, so it is tested without
 * rendering anything.
 */
import type { ArtifactView, RoutineGroup, RoutineView, UsageView, UsageWindowView } from '../../src/shared/protocol';
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

