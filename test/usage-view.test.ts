import { describe, expect, it, vi } from 'vitest';
import { escape, percentColor, resetExact, resetText, usageHtml, UsageView } from '../src/ui/usage-view';
import { parseUsage } from '../src/usage/model';
import type { UsageReading } from '../src/usage/reader';

type Listener = () => void;

/**
 * A `WebviewView` faithful enough for `UsageView`: `webview.options`,
 * `webview.html` (read back by the tests), `webview.onDidReceiveMessage`, and
 * `onDidDispose`. Not built on the shared `vscode` stub (test/stubs/vscode.ts):
 * nothing else in the codebase needs a webview, and a second consumer is what
 * would justify growing that file rather than this one.
 */
function fakeWebviewView(): {
  webview: { options: unknown; html: string; onDidReceiveMessage: (l: Listener) => { dispose: () => void } };
  onDidDispose: (l: Listener) => { dispose: () => void };
  htmlWriteCount: number;
  fireMessage: () => void;
  fireDispose: () => void;
} {
  let messageListener: Listener | undefined;
  let disposeListener: Listener | undefined;
  let html = '';
  let htmlWriteCount = 0;
  const self = {
    webview: {
      options: undefined as unknown,
      get html(): string {
        return html;
      },
      set html(value: string) {
        html = value;
        htmlWriteCount += 1;
      },
      onDidReceiveMessage: (listener: Listener) => {
        messageListener = listener;
        return { dispose: () => undefined };
      },
    },
    onDidDispose: (listener: Listener) => {
      disposeListener = listener;
      return { dispose: () => undefined };
    },
    get htmlWriteCount(): number {
      return htmlWriteCount;
    },
    fireMessage: () => messageListener?.(),
    fireDispose: () => disposeListener?.(),
  };
  return self;
}

const reading = (five: number, seven: number, resetsAt?: number, at = 0): UsageReading => ({
  usage: parseUsage({
    five_hour: { used_percentage: five, resets_at: resetsAt },
    seven_day: { used_percentage: seven },
  })!,
  source: 'api',
  at,
});

describe('percentColor', () => {
  it('goes from green to orange at 50%, then to red at 80%', () => {
    expect(percentColor(0)).toContain('green');
    expect(percentColor(50)).toContain('green');
    expect(percentColor(51)).toContain('orange');
    expect(percentColor(80)).toContain('orange');
    expect(percentColor(81)).toContain('red');
    expect(percentColor(100)).toContain('red');
  });

  it('never hardcodes a color: the view must follow the theme', () => {
    for (const p of [10, 60, 95]) expect(percentColor(p)).toMatch(/^var\(--vscode-/);
  });
});

describe('resetText', () => {
  const at = (secondsFromNow: number, now: number) => ({
    percent: 10,
    resetsAt: Math.floor(now / 1000) + secondsFromNow,
  });

  it('says minutes, then hours, then days', () => {
    const now = 1_700_000_000_000;
    expect(resetText(at(30 * 60, now), now)).toBe('in 30 min');
    expect(resetText(at(2 * 3600, now), now)).toBe('in 2 h');
    expect(resetText(at(6 * 86_400, now), now)).toBe('in 6 d');
  });

  it('rounds down — a deadline must never look farther away than it is', () => {
    const now = 1_700_000_000_000;
    expect(resetText(at(2 * 3600 + 3500, now), now)).toBe('in 2 h');
  });

  it('never drops below "in 1 min" before the deadline', () => {
    const now = 1_700_000_000_000;
    expect(resetText(at(20, now), now)).toBe('in 1 min');
  });

  it('says reset rather than a negative delay', () => {
    const now = 1_700_000_000_000;
    expect(resetText(at(-60, now), now)).toBe('reset');
  });

  it('makes nothing up without a deadline', () => {
    expect(resetText({ percent: 10, resetsAt: undefined }, 0)).toBe('');
    expect(resetText(undefined, 0)).toBe('');
  });
});

describe('resetExact', () => {
  const now = 1_700_000_000_000;
  const at = (secondsFromNow: number) => ({ percent: 10, resetsAt: Math.floor(now / 1000) + secondsFromNow });

  it('gives the wall clock time of a five-hour reset', () => {
    const w = at(2 * 3600);
    const when = new Date(w.resetsAt * 1000);
    const hhmm = `${String(when.getHours()).padStart(2, '0')}:${String(when.getMinutes()).padStart(2, '0')}`;
    expect(resetExact(w, now, 'time', 'fr')).toBe(hhmm);
  });

  it('gives the day of a seven-day reset, and no hour', () => {
    const w = at(6 * 86_400);
    const text = resetExact(w, now, 'date', 'fr');
    expect(text).toContain(String(new Date(w.resetsAt * 1000).getDate()));
    expect(text).not.toMatch(/\d:\d/);
  });

  it('names the weekday, which reads faster than a number inside a single week', () => {
    const w = at(6 * 86_400);
    const weekday = new Intl.DateTimeFormat('fr', { weekday: 'short' }).format(new Date(w.resetsAt * 1000));
    expect(resetExact(w, now, 'date', 'fr')).toContain(weekday);
  });

  it('follows the editor language rather than the host locale', () => {
    expect(resetExact(at(2 * 3600), now, 'time', 'en')).toMatch(/AM|PM/);
    expect(resetExact(at(2 * 3600), now, 'time', 'fr')).not.toMatch(/AM|PM/);
  });

  it('says nothing once the deadline has passed, where the relative text already says reset', () => {
    expect(resetExact(at(-60), now, 'time', 'fr')).toBe('');
  });

  it('says nothing without a deadline', () => {
    expect(resetExact({ percent: 10, resetsAt: undefined }, now, 'time', 'fr')).toBe('');
    expect(resetExact(undefined, now, 'date', 'fr')).toBe('');
  });
});

describe('usageHtml', () => {
  const now = 1_700_000_000_000;

  const withModel = (name: string, percent: number, resetsAt?: number): UsageReading => ({
    usage: parseUsage({
      five_hour: { utilization: 30 },
      seven_day: { utilization: 5 },
      limits: [{ kind: 'weekly_scoped', percent, resets_at: resetsAt, scope: { model: { display_name: name } } }],
    })!,
    source: 'api',
    at: now,
  });

  it('gives a model its own weekly row, under the two shared ones', () => {
    const html = usageHtml(withModel('Fable', 13, Math.floor(now / 1000) + 86_400), now);
    expect(html).toContain('<span class="kind">7 d Fable</span>');
    expect(html).toContain(`<span class="pct" style="color:${percentColor(13)}">13 %</span>`);
    expect(html).toContain('in 1 d');
    expect(html.indexOf('7 d Fable')).toBeGreaterThan(html.indexOf('<span class="kind">7 d</span>'));
  });

  const bothDeadlines = (): UsageReading => ({
    usage: parseUsage({
      five_hour: { utilization: 30, resets_at: Math.floor(now / 1000) + 7200 },
      seven_day: { utilization: 5, resets_at: Math.floor(now / 1000) + 6 * 86_400 },
    })!,
    source: 'api',
    at: now,
  });

  // The deadline cell of one row, and nothing else. A row ends at its newline
  // — the last one is followed by the whole page — and the cells before it
  // carry brackets of their own, `var(--vscode-charts-green)` among them,
  // which would answer for a date the row does not carry.
  const resetOf = (html: string, kind: string): string => {
    const found = html.split('<span class="kind">').find((part) => part.startsWith(`${kind}<`)) ?? '';
    return found.split('\n')[0]?.split('<span class="reset">')[1] ?? '';
  };

  it('puts a clock time behind the five-hour countdown, and a date behind the seven-day one', () => {
    const html = usageHtml(bothDeadlines(), now);
    expect(resetOf(html, '5 h')).toMatch(/in 2 h <i>\(\d{1,2}:\d{2}/);
    expect(resetOf(html, '7 d')).toMatch(/in 6 d <i>\([^)]+\)<\/i>/);
    expect(resetOf(html, '7 d')).not.toMatch(/\d:\d/);
  });

  it('sets the exact moment in italic, one step quieter than the delay it follows', () => {
    const reset = resetOf(usageHtml(bothDeadlines(), now), '7 d');
    expect(reset).toMatch(/^• in 6 d <i>\([^<]+\)<\/i>/);
    expect(reset).not.toMatch(/<i>in 6 d/);
  });

  it('dates a model row like the weekly window it is', () => {
    const row = resetOf(usageHtml(withModel('Fable', 13, Math.floor(now / 1000) + 86_400), now), '7 d Fable');
    expect(row).toMatch(/in 1 d <i>\([^)]+\)<\/i>/);
    expect(row).not.toMatch(/\d:\d/);
  });

  it('leaves a model row undated when it repeats the date of the row above it', () => {
    const sameDay = Math.floor(now / 1000) + 6 * 86_400;
    const html = usageHtml(
      {
        usage: parseUsage({
          five_hour: { utilization: 30 },
          seven_day: { utilization: 5, resets_at: sameDay },
          limits: [{ kind: 'weekly_scoped', percent: 12, resets_at: sameDay, scope: { model: { display_name: 'Fable' } } }],
        })!,
        source: 'api',
        at: now,
      },
      now,
    );
    expect(resetOf(html, '7 d')).toMatch(/in 6 d <i>\([^)]+\)<\/i>/);
    expect(resetOf(html, '7 d Fable')).toContain('in 6 d');
    expect(resetOf(html, '7 d Fable')).not.toContain('<i>');
  });

  it('dates a model row that reopens on another day than the shared window', () => {
    const html = usageHtml(
      {
        usage: parseUsage({
          five_hour: { utilization: 30 },
          seven_day: { utilization: 5, resets_at: Math.floor(now / 1000) + 6 * 86_400 },
          limits: [
            {
              kind: 'weekly_scoped',
              percent: 12,
              resets_at: Math.floor(now / 1000) + 2 * 86_400,
              scope: { model: { display_name: 'Fable' } },
            },
          ],
        })!,
        source: 'api',
        at: now,
      },
      now,
    );
    expect(resetOf(html, '7 d Fable')).toMatch(/in 2 d <i>\([^)]+\)<\/i>/);
  });

  it('escapes the model name: it is data from the API, not a label of ours', () => {
    expect(usageHtml(withModel('<b>x</b>', 1), now)).not.toContain('<b>x</b>');
  });

  it('gives every row the same three cells, so the grid stays aligned with or without a deadline', () => {
    const html = usageHtml(withModel('Fable', 13), now);
    const cells = (cls: string): number => html.split(`<span class="${cls}"`).length - 1;
    expect(cells('kind')).toBe(3);
    expect(cells('pct')).toBe(3);
    expect(cells('reset')).toBe(3);
  });

  it('gives each window its name, its percentage and its deadline', () => {
    const html = usageHtml(reading(30, 5, Math.floor(now / 1000) + 7200), now);
    expect(html).toContain('5 h');
    expect(html).toContain('30 %');
    expect(html).toContain('7 d');
    expect(html).toContain('5 %');
    expect(html).toContain('in 2 h');
  });

  it('colors the percentage, and only the percentage', () => {
    const html = usageHtml(reading(90, 5), now);
    // The window's name stays in the current text color; only the
    // percentage carries its own color.
    expect(html).toContain(`<span class="pct" style="color:${percentColor(90)}">90 %</span>`);
    expect(html).toContain('<span class="kind">5 h</span>');
  });

  it('says where the reading comes from and since when', () => {
    expect(usageHtml(reading(1, 1, undefined, now - 120_000), now)).toContain('Anthropic');
    expect(usageHtml(reading(1, 1, undefined, now - 120_000), now)).toContain('2 min');
    expect(usageHtml(reading(1, 1, undefined, now), now)).toContain('just now');
  });

  it('escapes what it interpolates, including its own labels', () => {
    // A label stops being "its own" the moment it could come from a bundle:
    // « just now » carries no apostrophe, « à l'instant » does, and German
    // has its own quotation marks. The test therefore targets the escaping
    // itself, which the source language can no longer exercise.
    expect(escape("à l'instant")).toBe('à l&#39;instant');
    expect(escape('<b>&"</b>')).toBe('&#60;b&#62;&#38;&#34;&#60;/b&#62;');
  });

  it('stays displayable without any reading, and offers to refresh', () => {
    // The source is English, as everywhere: the message goes through
    // vscode.l10n.t, and the test stub returns the source string as is.
    const html = usageHtml(undefined, now);
    expect(html).toContain('unknown');
    expect(html).toContain('refresh');
  });

  it('escapes what comes from the outside', () => {
    // The source and the labels are our own, but the rule holds by default:
    // a webview must never interpolate without escaping.
    expect(usageHtml(undefined, now)).not.toContain('<script>alert');
  });
});

describe('UsageView', () => {
  const aReading = (percent: number): UsageReading => ({
    usage: parseUsage({ five_hour: { used_percentage: percent } })!,
    source: 'api',
    at: Date.now(),
  });

  it('keeps a reading set before any view exists, without writing anywhere', () => {
    const view = new UsageView(() => undefined);
    expect(() => view.setUsage(aReading(10))).not.toThrow();
  });

  it('paints the webview with whatever reading it already had, as soon as it resolves', () => {
    const view = new UsageView(() => undefined);
    view.setUsage(aReading(42));
    const webview = fakeWebviewView();
    view.resolveWebviewView(webview as unknown as Parameters<UsageView['resolveWebviewView']>[0]);
    expect(webview.webview.options).toEqual({ enableScripts: true });
    expect(webview.webview.html).toContain('42 %');
    expect(webview.htmlWriteCount).toBe(1);
  });

  it('repaints on every new reading once a view is attached', () => {
    const view = new UsageView(() => undefined);
    const webview = fakeWebviewView();
    view.resolveWebviewView(webview as unknown as Parameters<UsageView['resolveWebviewView']>[0]);
    view.setUsage(aReading(7));
    expect(webview.webview.html).toContain('7 %');
    expect(webview.htmlWriteCount).toBe(2);
  });

  it('never rewrites the webview for a repaint that renders the same html', () => {
    const view = new UsageView(() => undefined);
    const webview = fakeWebviewView();
    view.resolveWebviewView(webview as unknown as Parameters<UsageView['resolveWebviewView']>[0]);
    const reading = aReading(55);
    view.setUsage(reading);
    view.setUsage(reading);
    // One write for the initial resolve, and a SECOND one for the first
    // setUsage above — not a third: the two calls to setUsage render the
    // exact same html, and a rewritten webview loses its selection and hover.
    expect(webview.htmlWriteCount).toBe(2);
  });

  it('calls the constructor callback when the webview posts a message back', () => {
    const onRefresh = vi.fn();
    const view = new UsageView(onRefresh);
    const webview = fakeWebviewView();
    view.resolveWebviewView(webview as unknown as Parameters<UsageView['resolveWebviewView']>[0]);
    webview.fireMessage();
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('stops painting a webview that disposed itself, and paints again on the next resolve', () => {
    const view = new UsageView(() => undefined);
    const webview = fakeWebviewView();
    view.resolveWebviewView(webview as unknown as Parameters<UsageView['resolveWebviewView']>[0]);
    webview.fireDispose();
    // Writing here would throw against a real, disposed webview — the whole
    // reason the reference is dropped on dispose.
    view.setUsage(aReading(99));
    expect(webview.htmlWriteCount).toBe(1);

    // Resolved again (e.g. the container is shown again): forced to repaint
    // even though the reading has not changed since the last paint.
    view.resolveWebviewView(webview as unknown as Parameters<UsageView['resolveWebviewView']>[0]);
    expect(webview.htmlWriteCount).toBe(2);
    expect(webview.webview.html).toContain('99 %');
  });
});
