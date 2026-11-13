import * as vscode from 'vscode';
import type { Routine } from '../routines/model';
import type { RoutineGroup } from '../routines/schedule';
import { dayText, fullText, timeText, weekdayTimeText } from './dates';

const GROUP: Record<RoutineGroup, () => string> = {
  today: () => vscode.l10n.t('Today'),
  tomorrow: () => vscode.l10n.t('Tomorrow'),
  week: () => vscode.l10n.t('This week'),
  later: () => vscode.l10n.t('Later'),
  paused: () => vscode.l10n.t('Paused'),
};

export function groupLabel(group: RoutineGroup): string {
  return GROUP[group]();
}

/**
 * What sits right of a routine's name.
 *
 * For a routine that will run: when, at the precision its group calls for —
 * the hour today and tomorrow, the day's name within the week, the date past
 * it. A paused one says what it would do instead: its next date is a fiction
 * (see `groupOf`).
 */
export function routineDescription(r: Routine, group: RoutineGroup, now: number, locale: string): string {
  if (group === 'paused') {
    if (r.fired) {
      return r.runOnceAt === undefined
        ? vscode.l10n.t('already ran')
        : vscode.l10n.t('ran {0}', dayText(r.runOnceAt, now, locale));
    }
    if (r.cron !== undefined) return r.cron;
    return r.runOnceAt === undefined ? '' : `${dayText(r.runOnceAt, now, locale)} · ${vscode.l10n.t('once')}`;
  }
  const when = r.nextRunAt === undefined ? vscode.l10n.t('no next run') : whenText(r.nextRunAt, group, now, locale);
  return r.cron === undefined ? `${when} · ${vscode.l10n.t('once')}` : when;
}

function whenText(at: number, group: RoutineGroup, now: number, locale: string): string {
  if (group === 'today' || group === 'tomorrow') return timeText(at, locale);
  if (group === 'week') return weekdayTimeText(at, locale);
  return dayText(at, now, locale);
}

export function routineTooltip(r: Routine, locale: string): string {
  const lines = [r.name];
  if (r.cron !== undefined) lines.push(vscode.l10n.t('Schedule: {0} (cron, UTC)', r.cron));
  else if (r.runOnceAt !== undefined) lines.push(vscode.l10n.t('Once: {0}', fullText(r.runOnceAt, locale)));
  if (r.fired) lines.push(vscode.l10n.t('Already ran — nothing left to run'));
  else if (!r.enabled) lines.push(vscode.l10n.t('Paused'));
  else if (r.nextRunAt !== undefined) lines.push(vscode.l10n.t('Next run: {0}', fullText(r.nextRunAt, locale)));
  if (r.repos.length > 0) lines.push(vscode.l10n.t('Repositories: {0}', r.repos.join(', ')));
  lines.push(vscode.l10n.t('Click to open on claude.ai'));
  return lines.join('\n');
}
