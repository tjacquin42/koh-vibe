import { describe, expect, it } from 'vitest';
import { escape, percentColor, resetExact, resetText, usageHtml } from '../src/ui/usage-view';
import { parseUsage } from '../src/usage/model';
import type { UsageReading } from '../src/usage/reader';

const reading = (five: number, seven: number, resetsAt?: number, at = 0): UsageReading => ({
  usage: parseUsage({
    five_hour: { used_percentage: five, resets_at: resetsAt },
    seven_day: { used_percentage: seven },
  })!,
  source: 'api',
  at,
});

describe('percentColor', () => {
  it('passe du vert à l orange à 50 %, puis au rouge à 80 %', () => {
    expect(percentColor(0)).toContain('green');
    expect(percentColor(50)).toContain('green');
    expect(percentColor(51)).toContain('orange');
    expect(percentColor(80)).toContain('orange');
    expect(percentColor(81)).toContain('red');
    expect(percentColor(100)).toContain('red');
  });

  it('ne cite jamais une couleur en dur : la vue doit suivre le thème', () => {
    for (const p of [10, 60, 95]) expect(percentColor(p)).toMatch(/^var\(--vscode-/);
  });
});

describe('resetText', () => {
  const at = (secondsFromNow: number, now: number) => ({
    percent: 10,
    resetsAt: Math.floor(now / 1000) + secondsFromNow,
  });

  it('dit les minutes, les heures, puis les jours', () => {
    const now = 1_700_000_000_000;
    expect(resetText(at(30 * 60, now), now)).toBe('in 30 min');
    expect(resetText(at(2 * 3600, now), now)).toBe('in 2 h');
    expect(resetText(at(6 * 86_400, now), now)).toBe('in 6 d');
  });

  it('arrondit vers le bas — une échéance ne doit jamais paraître plus lointaine', () => {
    const now = 1_700_000_000_000;
    expect(resetText(at(2 * 3600 + 3500, now), now)).toBe('in 2 h');
  });

  it('ne descend jamais sous « dans 1 min » avant l échéance', () => {
    const now = 1_700_000_000_000;
    expect(resetText(at(20, now), now)).toBe('in 1 min');
  });

  it('dit la remise à zéro plutôt qu un délai négatif', () => {
    const now = 1_700_000_000_000;
    expect(resetText(at(-60, now), now)).toBe('reset');
  });

  it('n invente rien sans échéance', () => {
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

  it('donne à chaque fenêtre son nom, son pourcentage et son échéance', () => {
    const html = usageHtml(reading(30, 5, Math.floor(now / 1000) + 7200), now);
    expect(html).toContain('5 h');
    expect(html).toContain('30 %');
    expect(html).toContain('7 d');
    expect(html).toContain('5 %');
    expect(html).toContain('in 2 h');
  });

  it('colore le pourcentage, et lui seul', () => {
    const html = usageHtml(reading(90, 5), now);
    // Le nom de la fenêtre reste dans la couleur du texte courant ; seul le
    // pourcentage porte une couleur propre.
    expect(html).toContain(`<span class="pct" style="color:${percentColor(90)}">90 %</span>`);
    expect(html).toContain('<span class="kind">5 h</span>');
  });

  it('dit d où vient la mesure et depuis quand', () => {
    expect(usageHtml(reading(1, 1, undefined, now - 120_000), now)).toContain('Anthropic');
    expect(usageHtml(reading(1, 1, undefined, now - 120_000), now)).toContain('2 min');
    expect(usageHtml(reading(1, 1, undefined, now), now)).toContain('just now');
  });

  it('échappe ce qu elle interpole, y compris ses propres libellés', () => {
    // Un libellé cesse d être « le sien » dès qu il peut venir d un bundle :
    // « just now » n a pas d apostrophe, « à l instant » en a une, et l allemand
    // a ses guillemets. Le test porte donc sur l échappement lui-même, que la
    // langue de la source ne peut plus exercer.
    expect(escape("à l'instant")).toBe('à l&#39;instant');
    expect(escape('<b>&"</b>')).toBe('&#60;b&#62;&#38;&#34;&#60;/b&#62;');
  });

  it('reste affichable sans aucune mesure, et propose de rafraîchir', () => {
    // La source est l'anglais, comme partout : le message passe par
    // vscode.l10n.t, et le bouchon de test rend la chaîne source telle quelle.
    const html = usageHtml(undefined, now);
    expect(html).toContain('unknown');
    expect(html).toContain('refresh');
  });

  it('échappe ce qui vient de l extérieur', () => {
    // La source et les libellés sont à nous, mais la règle vaut par défaut : une
    // vue web ne doit jamais interpoler sans échapper.
    expect(usageHtml(undefined, now)).not.toContain('<script>alert');
  });
});
