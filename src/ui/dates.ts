/**
 * Dates as a row shows them, in the editor's display language. Kept apart
 * from `vscode` — they only need `Intl` — so both cloud views share them and
 * a test can pin the locale.
 */

/** « 28 sept. » — the year only when it is not the current one. */
export function dayText(at: number, now: number, locale: string): string {
  const sameYear = new Date(at).getFullYear() === new Date(now).getFullYear();
  return new Intl.DateTimeFormat(
    locale,
    sameYear ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' },
  ).format(new Date(at));
}

/** « 06:12 » */
export function timeText(at: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(new Date(at));
}

/** « lun. 14:52 » — within the week, the day's name reads faster than its number. */
export function weekdayTimeText(at: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, { weekday: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(at));
}

/** « lundi 28 septembre 2026 à 06:12 » — for a tooltip, where there is room for all of it. */
export function fullText(at: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'full', timeStyle: 'short' }).format(new Date(at));
}
