/**
 * Whole calendar days from `from` to `to`, in the machine's own time zone: 0
 * the same day, 1 the next, negative before.
 *
 * Counted on dates, never on elapsed hours: 23:50 to 00:10 is one day, and a
 * daylight-saving change does not make a day 23 or 25 hours long here — each
 * local date is turned into midnight UTC before subtracting.
 */
export function calendarDaysBetween(from: number, to: number): number {
  const a = new Date(from);
  const b = new Date(to);
  const dayA = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  const dayB = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((dayB - dayA) / 86_400_000);
}
