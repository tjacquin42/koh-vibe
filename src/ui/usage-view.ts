import * as vscode from 'vscode';
import type { UsageReading, UsageSource } from '../usage/reader';
import type { Usage, UsageWindow } from '../usage/model';

/**
 * Usage, as a webview rather than a tree.
 *
 * A tree row can only be colored as one block: VSCode offers neither
 * segments nor styling within a label. But what we want to say lies
 * precisely in the contrast — the window's name in plain text, the
 * percentage colored by what it's worth, the deadline set back a step. A
 * webview is the only place where this distinction exists.
 *
 * Every color comes from the editor's theme variables, never from a
 * hardcoded one: the view has to follow the light theme as well as the dark
 * one.
 */
const GREEN_UNTIL = 50;
const ORANGE_UNTIL = 80;

/** Green up to 50%, orange up to 80%, red beyond. */
export function percentColor(percent: number): string {
  if (percent <= GREEN_UNTIL) return 'var(--vscode-charts-green)';
  if (percent <= ORANGE_UNTIL) return 'var(--vscode-charts-orange)';
  return 'var(--vscode-charts-red)';
}

/**
 * « in 2 h », « in 6 d » — the delay before reset, rounded down like
 * everywhere else: a deadline reads downward, never upward, or you'd think
 * you have more time than you actually do.
 */
export function resetText(w: UsageWindow | undefined, now: number): string {
  if (w?.resetsAt === undefined) return '';
  const remaining = w.resetsAt * 1000 - now;
  if (remaining <= 0) return vscode.l10n.t('reset');
  const hours = Math.floor(remaining / 3_600_000);
  if (hours < 1) return vscode.l10n.t('in {0} min', Math.max(1, Math.floor(remaining / 60_000)));
  if (hours < 24) return vscode.l10n.t('in {0} h', hours);
  return vscode.l10n.t('in {0} d', Math.floor(hours / 24));
}

/** The time for a 5 h window, the day for a 7 d window. */
export type ResetPrecision = 'time' | 'date';

/**
 * The deadline spelled out, next to the delay.
 *
 * « in 6 d » says how much is left, and that's what you want to know first
 * — but it doesn't fit on a calendar. The two together answer both
 * questions: how much time, and exactly when.
 *
 * Precision follows the window rather than the remaining delay: a 5 h
 * window reopens within the day, so an hour is enough and a date would be
 * noise; a 7 d window reopens on another day, so the hour says nothing
 * without the day. The day's name goes along with the date: within a week,
 * « Tue » reads faster than « 9 ».
 *
 * Nothing to say once the deadline has passed: `resetText` then shows
 * « reset », and the hour of an already-done reset no longer teaches
 * anything.
 */
export function resetExact(
  w: UsageWindow | undefined,
  now: number,
  precision: ResetPrecision,
  locale: string,
): string {
  if (w?.resetsAt === undefined) return '';
  const at = w.resetsAt * 1000;
  if (at - now <= 0) return '';
  return new Intl.DateTimeFormat(
    locale,
    precision === 'time'
      ? { hour: '2-digit', minute: '2-digit' }
      : { weekday: 'short', day: 'numeric', month: 'short' },
  ).format(new Date(at));
}

const SOURCE: Record<UsageSource, () => string> = {
  api: () => 'Anthropic',
  statusline: () => vscode.l10n.t('Claude Code status line'),
};

/**
 * Escapes everything the view interpolates, with no exception for its own
 * labels — because they are not its own once translated. English has no
 * apostrophe in "just now"; French does, and so do quotation marks in German.
 * A label is untrusted input the moment it can come from a bundle.
 */
export function escape(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/**
 * One row of the grid: always its three cells, even with nothing to say about
 * a deadline. The rows are laid out by a CSS grid so that the percentages line
 * up whatever the width of the label in front of them — "5 h" and "7 d Fable"
 * share the columns — and a grid places cells by count: a row short of one
 * would pull every following row one cell to the left.
 */
function row(label: string, w: UsageWindow | undefined, now: number, exact: string): string {
  if (w === undefined) return '';
  const percent = Math.round(w.percent);
  // One escaped string, not two: the parentheses are punctuation and have no
  // business going through `escape`, but everything coming from a format or
  // a bundle must — hence the assembly BEFORE the escaping.
  const relative = resetText(w, now);
  // The italics set the exact moment one step back from the delay: it
  // answers a question that only comes up afterwards. Each piece is escaped
  // separately — the tag itself is ours, not the format's or the bundle's.
  const reset =
    relative === '' || exact === ''
      ? escape(relative)
      : `${escape(relative)} <i>(${escape(exact)})</i>`;
  return `<span class="kind">${escape(label)}</span><span class="pct" style="color:${percentColor(percent)}">${percent} %</span><span class="reset">${reset === '' ? '' : `• ${reset}`}</span>
`;
}

/** The body of the view, kept apart from the webview so it can be tested without an editor. */
export function usageHtml(
  reading: UsageReading | undefined,
  now: number,
  // The editor's DISPLAY language, not the system's: the view is already
  // translated via `l10n`, and a « 9 sept. » under an English interface
  // would look out of place.
  locale: string = vscode.env.language,
): string {
  const body =
    reading === undefined
      ? `<div class="empty">${escape(vscode.l10n.t('Usage unknown — click to refresh.'))}</div>`
      : rowsOf(reading.usage, now, locale) + footer(reading, now);
  return `<style>
    body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size);
           color: var(--vscode-foreground); padding: 4px 12px 8px; }
    .rows { display: grid; grid-template-columns: max-content max-content auto; column-gap: 8px;
            align-items: baseline; line-height: 22px; white-space: nowrap; }
    .kind { color: var(--vscode-foreground); min-width: 2.2em; }
    .pct { font-variant-numeric: tabular-nums; text-align: right; min-width: 3.5em; }
    .reset, .src, .empty { color: var(--vscode-descriptionForeground); }
    .src { display: block; margin-top: 6px; font-size: 0.9em; }
    a { color: inherit; text-decoration: none; cursor: pointer; display: block; }
  </style>
  <a id="refresh" title="${escape(vscode.l10n.t('Click to refresh'))}">${body}</a>
  <script>
    const vscode = acquireVsCodeApi();
    document.getElementById('refresh').addEventListener('click', () => vscode.postMessage({ type: 'refresh' }));
  </script>`;
}

function rowsOf(u: Usage, now: number, locale: string): string {
  // The window names are abbreviations of durations, and abbreviations differ:
  // French writes days "j", English "d". A model's row carries the model's
  // name after the duration: the name is data from the API, escaped by `row`
  // like every label, never trusted for being short.
  const weekly = resetExact(u.sevenDay, now, 'date', locale);
  const shared =
    row(vscode.l10n.t('5 h'), u.fiveHour, now, resetExact(u.fiveHour, now, 'time', locale)) +
    row(vscode.l10n.t('7 d'), u.sevenDay, now, weekly);
  // A model window is a weekly one, so it is dated like the row above it —
  // and therefore NOT dated when that would repeat it word for word. Three
  // identical dates stacked up say no more than one, and the noise is what
  // the eye reads first. The date comes back the moment a model reopens on
  // another day, which is the only case where it carries anything.
  const models = u.models
    .map((m) => {
      const exact = resetExact(m, now, 'date', locale);
      return row(vscode.l10n.t('7 d {0}', m.name), m, now, exact === weekly ? '' : exact);
    })
    .join('');
  return `<div class="rows">${shared}${models}</div>`;
}

function footer(reading: UsageReading, now: number): string {
  const age = Math.max(0, Math.floor((now - reading.at) / 60_000));
  const when = age < 1 ? vscode.l10n.t('just now') : vscode.l10n.t('{0} min ago', age);
  return `<span class="src">${escape(SOURCE[reading.source]())} · ${escape(when)}</span>`;
}

export class UsageView implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined;
  private reading: UsageReading | undefined;
  private rendered: string | undefined;

  constructor(private readonly onRefresh: () => void) {}

  setUsage(reading: UsageReading | undefined): void {
    this.reading = reading;
    this.paint();
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true };
    view.webview.onDidReceiveMessage(() => this.onRefresh());
    // VSCode disposes the webview when the view is destroyed (e.g. the
    // container hidden long enough). Writing HTML to a disposed webview
    // throws — and `paint()` runs on every render tick, so keeping the stale
    // reference made the WHOLE dashboard render fail until reload. Dropped
    // here; `resolveWebviewView` is called again when the view comes back.
    view.onDidDispose(() => {
      if (this.view === view) this.view = undefined;
    });
    // Force the render: the view has just appeared, it hasn't shown anything yet.
    this.rendered = undefined;
    this.paint();
  }

  private paint(): void {
    if (this.view === undefined) return;
    const html = usageHtml(this.reading, Date.now());
    // Same rule as for trees: rewrite nothing when nothing has changed. A
    // rewritten webview loses its selection and its hover.
    if (html === this.rendered) return;
    this.rendered = html;
    this.view.webview.html = html;
  }
}
