import * as vscode from 'vscode';
import type { FeedView } from '../cloud/feed';
import { formatAge } from './labels';

/**
 * What sits beside a cloud view's title: how old the list is, and whether the
 * server held some of it back. Empty until there is a list — a loading or
 * failed view says so in its body, and saying it twice would be noise.
 */
export function feedDescription(view: FeedView<unknown>, now: number): string {
  if (view.kind !== 'ready') return '';
  const age = now - view.snapshot.at;
  const fresh = age < 60_000 ? vscode.l10n.t('updated just now') : vscode.l10n.t('updated {0} ago', formatAge(age));
  return view.snapshot.truncated ? `${fresh} · ${vscode.l10n.t('incomplete list')}` : fresh;
}

/** The row standing in for a list not read yet. */
export function loadingItem(id: string): vscode.TreeItem {
  const item = new vscode.TreeItem(vscode.l10n.t('Loading…'));
  item.id = id;
  item.iconPath = new vscode.ThemeIcon('loading~spin');
  return item;
}

/**
 * The row standing in for a failed read — and the button to try again: a
 * failed read has nothing else to offer.
 */
export function retryItem(id: string, label: string, icon: string, tooltip: string, command: string): vscode.TreeItem {
  const item = new vscode.TreeItem(label);
  item.id = id;
  item.iconPath = new vscode.ThemeIcon(icon);
  item.tooltip = tooltip;
  item.command = { command, title: vscode.l10n.t('Retry') };
  return item;
}

/** What claude.ai's silence means — the same for both views. */
export function unavailableTooltip(): string {
  return vscode.l10n.t(
    'claude.ai did not answer, or answered in a form Koh-Vibe does not know. Koh-Vibe asks again every five minutes while this view is open.',
  );
}
