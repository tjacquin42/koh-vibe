import * as vscode from 'vscode';
import type { Artifact } from '../artifacts/model';
import { calendarDaysBetween } from '../lib/days';
import { dayText, fullText } from './dates';

export function artifactLabel(a: Artifact): string {
  return a.title.length > 0 ? a.title : vscode.l10n.t('Untitled');
}

/** « today », « 3 d ago », then the date: recent work reads in days, older work in dates. */
export function updatedText(at: number | undefined, now: number, locale: string): string {
  if (at === undefined) return '';
  const days = calendarDaysBetween(at, now);
  // A date ahead of the clock — another machine's — reads as today.
  if (days <= 0) return vscode.l10n.t('today');
  if (days === 1) return vscode.l10n.t('yesterday');
  if (days < 7) return vscode.l10n.t('{0} d ago', days);
  return dayText(at, now, locale);
}

export function artifactTooltip(a: Artifact, locale: string): string {
  const lines = [artifactLabel(a)];
  if (a.pinned) lines.push(vscode.l10n.t('Pinned on claude.ai'));
  if (a.updatedAt !== undefined) lines.push(vscode.l10n.t('Updated: {0}', fullText(a.updatedAt, locale)));
  lines.push(vscode.l10n.t('Click to open on claude.ai'));
  return lines.join('\n');
}

/** The two folders above the projects: the pinned pages, and the most recent. */
export function shelfLabel(shelf: 'pinned' | 'recent'): string {
  return shelf === 'pinned' ? vscode.l10n.t('Pinned') : vscode.l10n.t('Recent');
}

/** The folder of what is filed under no project — « Divers » in French. */
export function otherLabel(): string {
  return vscode.l10n.t('Other');
}

export function projectTooltip(label: string, count: number): string {
  return count === 1 ? vscode.l10n.t('{0} — 1 artifact', label) : vscode.l10n.t('{0} — {1} artifacts', label, count);
}
