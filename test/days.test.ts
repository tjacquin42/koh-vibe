import { describe, expect, it } from 'vitest';
import { calendarDaysBetween } from '../src/lib/days';

const at = (y: number, m: number, d: number, h = 12, min = 0): number => new Date(y, m - 1, d, h, min).getTime();

describe('calendarDaysBetween', () => {
  it('counts dates, not hours: ten minutes across midnight is one day', () => {
    expect(calendarDaysBetween(at(2026, 9, 28, 23, 50), at(2026, 9, 29, 0, 10))).toBe(1);
  });

  it('is zero within a day, whatever the hours', () => {
    expect(calendarDaysBetween(at(2026, 9, 28, 0, 1), at(2026, 9, 28, 23, 59))).toBe(0);
  });

  it('goes negative backwards', () => {
    expect(calendarDaysBetween(at(2026, 9, 29), at(2026, 9, 28))).toBe(-1);
  });

  it('crosses a month and a year', () => {
    expect(calendarDaysBetween(at(2026, 9, 28), at(2026, 10, 5))).toBe(7);
    expect(calendarDaysBetween(at(2026, 12, 31), at(2027, 1, 1))).toBe(1);
  });

  it('is not thrown off by a daylight-saving change', () => {
    // Europe changes its clocks on the last Sunday of October: a 25-hour day where it applies.
    expect(calendarDaysBetween(at(2026, 10, 24), at(2026, 10, 26))).toBe(2);
  });
});
