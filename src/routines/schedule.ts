import { calendarDaysBetween } from '../lib/days';
import type { Routine } from './model';

/** Where a routine sits in the view: by when it runs next, then the ones that will not run on their own. */
export type RoutineGroup = 'today' | 'tomorrow' | 'week' | 'later' | 'paused';

export const ROUTINE_GROUPS: readonly RoutineGroup[] = ['today', 'tomorrow', 'week', 'later', 'paused'];

export function groupOf(r: Routine, now: number): RoutineGroup {
  // Before any date: the server keeps a `next_run_at` on a paused routine, a
  // date that will never come — trusting it would file a paused routine
  // under Tomorrow.
  if (!r.enabled || r.fired) return 'paused';
  if (r.nextRunAt === undefined) return 'later';
  const days = calendarDaysBetween(now, r.nextRunAt);
  // Overdue — the scheduler running late — reads as today: it is about to run.
  if (days <= 0) return 'today';
  if (days === 1) return 'tomorrow';
  // Seven rolling days, not the calendar week: on a Sunday, « this week » would hold nothing.
  if (days < 7) return 'week';
  return 'later';
}

/**
 * A one-shot with nothing left to resume: it fired, or its date has passed
 * while it was paused. Resuming either would ask the scheduler what a date in
 * the past means — perhaps a run straight away, with real effects and none of
 * the confirmation « Run now » asks for. A recurring routine is never spent.
 */
export function isSpent(r: Routine, now: number): boolean {
  return r.fired || (r.cron === undefined && r.runOnceAt !== undefined && r.runOnceAt <= now);
}

export interface RoutineSection {
  group: RoutineGroup;
  routines: Routine[];
}

/** The non-empty groups in view order; by next run inside each, by name among the paused. */
export function sectionsOf(routines: readonly Routine[], now: number): RoutineSection[] {
  const byGroup = new Map<RoutineGroup, Routine[]>();
  for (const r of routines) {
    const group = groupOf(r, now);
    byGroup.set(group, [...(byGroup.get(group) ?? []), r]);
  }
  const sections: RoutineSection[] = [];
  for (const group of ROUTINE_GROUPS) {
    const list = byGroup.get(group);
    if (list === undefined) continue;
    sections.push({ group, routines: [...list].sort(group === 'paused' ? byName : byNextRun) });
  }
  return sections;
}

function byName(a: Routine, b: Routine): number {
  return a.name.localeCompare(b.name);
}

function byNextRun(a: Routine, b: Routine): number {
  const ta = a.nextRunAt ?? Number.POSITIVE_INFINITY;
  const tb = b.nextRunAt ?? Number.POSITIVE_INFINITY;
  return ta === tb ? byName(a, b) : ta - tb;
}
