/**
 * Dates as a row shows them, in the editor's display language. Kept apart
 * from `vscode` — they only need `Intl` — so both cloud views share them and
 * a test can pin the locale.
 *
 * An impossible time draws as nothing: `Intl` throws on an Invalid Date, and a
 * throw here would land in the middle of a render.
 */

/** The date to format, or nothing when no `Date` can hold `at`. */
function dateOf(at: number): Date | undefined {
  const d = new Date(at);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/** « 28 sept. » — the year only when it is not the current one. */
export function dayText(at: number, now: number, locale: string): string {
  const d = dateOf(at);
  if (d === undefined) return '';
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  return new Intl.DateTimeFormat(
    locale,
    sameYear ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' },
  ).format(d);
}

/** « 06:12 » */
export function timeText(at: number, locale: string): string {
  const d = dateOf(at);
  return d === undefined ? '' : new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(d);
}

/** « lun. 14:52 » — within the week, the day's name reads faster than its number. */
export function weekdayTimeText(at: number, locale: string): string {
  const d = dateOf(at);
  return d === undefined
    ? ''
    : new Intl.DateTimeFormat(locale, { weekday: 'short', hour: '2-digit', minute: '2-digit' }).format(d);
}

/** « lundi 28 septembre 2026 à 06:12 » — for a tooltip, where there is room for all of it. */
export function fullText(at: number, locale: string): string {
  const d = dateOf(at);
  return d === undefined ? '' : new Intl.DateTimeFormat(locale, { dateStyle: 'full', timeStyle: 'short' }).format(d);
}
