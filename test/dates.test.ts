import { describe, expect, it } from 'vitest';
import { dayText, fullText, timeText, weekdayTimeText } from '../src/ui/dates';

const NOW = new Date(2026, 8, 28, 10, 0).getTime();

describe('the date labels', () => {
  it('draw an impossible time as nothing, rather than throwing in the middle of a render', () => {
    for (const at of [1e300, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(dayText(at, NOW, 'fr')).toBe('');
      expect(timeText(at, 'fr')).toBe('');
      expect(weekdayTimeText(at, 'fr')).toBe('');
      expect(fullText(at, 'fr')).toBe('');
    }
  });
});
