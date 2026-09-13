import * as vscode from 'vscode';

/**
 * The palette offered for folders.
 *
 * `id` is what gets written to groups.json: neutral, stable, independent of
 * language and theme. `theme` is a colour registered by VSCode — never a hex
 * code — so that folders stay readable in light and dark, and under
 * third-party themes. `label` exists only for the picker.
 *
 * Two families, where one would be preferable: `charts.*` already colours the
 * status dots (ui/tree.ts), but it holds six hues only — the table below had
 * exhausted every one of them. `terminal.ansi*` is the other family VSCode
 * registers and every theme defines, precisely because it is built so that its
 * entries tell each other apart. The hues taken from it are the ones
 * `charts.*` does not have.
 *
 * The order is the spectrum's, not the order they were added in: a list of
 * colours is scanned by eye, and a rainbow reads without thinking where an
 * arbitrary order forces a second pass.
 */
export interface GroupColor {
  id: string;
  /** Shown in the picker, so translated. Never written to disk — `id` is. */
  label: string;
  theme: string;
}

export const GROUP_COLORS: readonly GroupColor[] = [
  { id: 'blue', label: vscode.l10n.t('Blue'), theme: 'charts.blue' },
  { id: 'indigo', label: vscode.l10n.t('Indigo'), theme: 'terminal.ansiBlue' },
  { id: 'cyan', label: vscode.l10n.t('Cyan'), theme: 'terminal.ansiCyan' },
  { id: 'green', label: vscode.l10n.t('Green'), theme: 'charts.green' },
  { id: 'lime', label: vscode.l10n.t('Lime'), theme: 'terminal.ansiBrightGreen' },
  { id: 'yellow', label: vscode.l10n.t('Yellow'), theme: 'charts.yellow' },
  { id: 'orange', label: vscode.l10n.t('Orange'), theme: 'charts.orange' },
  { id: 'red', label: vscode.l10n.t('Red'), theme: 'charts.red' },
  { id: 'pink', label: vscode.l10n.t('Pink'), theme: 'terminal.ansiMagenta' },
  { id: 'purple', label: vscode.l10n.t('Purple'), theme: 'charts.purple' },
];

/**
 * An unknown colour counts as «no colour», never as an error: the file is
 * shared, and a newer version of the extension installed on the other editor
 * may well have written a colour this one does not know yet. The folder then
 * shows with no colour — and the unknown value survives in the file, it is
 * not overwritten.
 */
export function themeColorOf(color: string | undefined): string | undefined {
  if (color === undefined) return undefined;
  return GROUP_COLORS.find((c) => c.id === color)?.theme;
}

/** The picker entry that removes the colour. */
export const NO_COLOR_LABEL = vscode.l10n.t('None');

/**
 * What the user's choice in the colour list actually means.
 *
 * Three cases, and it matters that they stay three: closing the list
 * (`undefined`) is NOT the same as choosing «None». If the two were
 * conflated, cancelling would erase the folder's colour — the most harmless
 * gesture would become destructive.
 *
 * A label the code doesn't recognise counts as a cancellation, never as an
 * erasure: this is the case that should never happen, since the list is
 * built from this very palette. It is handled anyway, because one day the
 * list and the palette might stop being built together, and on that day the
 * worst possible outcome would be to erase silently.
 */
export type ColorChoice = { kind: 'cancel' } | { kind: 'set'; color: string | undefined };

export function colorChoice(pick: string | undefined): ColorChoice {
  if (pick === undefined) return { kind: 'cancel' };
  if (pick === NO_COLOR_LABEL) return { kind: 'set', color: undefined };
  const found = GROUP_COLORS.find((c) => c.label === pick);
  return found === undefined ? { kind: 'cancel' } : { kind: 'set', color: found.id };
}

/**
 * The preview under way: what a folder would show if the choice were confirmed
 * now.
 *
 * `color: undefined` is a preview in its own right — the one for "None" — and
 * not the absence of a preview; it is the absence of the whole object that
 * says no preview is running. The same distinction `ColorChoice` makes above,
 * for the same reason: confusing the two would grey out every folder the
 * cursor passes over in the list.
 */
export interface ColorPreview {
  groupId: string;
  color: string | undefined;
}

/**
 * The colour a folder DISPLAYS: the preview's when it targets that folder, its
 * own otherwise.
 *
 * A per-window overlay, never written to disk — the same lesson as `dormant`
 * (spool/persist.ts): what describes a gesture in progress has no business in
 * a shared file, where it would outlive the gesture. The preview targets one
 * folder at a time, because one list is browsed at a time; the others keep
 * theirs, and watching the whole view change while choosing for a single
 * folder would say the wrong thing.
 */
export function shownColor(
  group: { id: string; color?: string } | undefined,
  preview: ColorPreview | undefined,
): string | undefined {
  if (group === undefined) return undefined;
  return preview !== undefined && preview.groupId === group.id ? preview.color : group.color;
}
