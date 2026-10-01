import { describe, expect, it } from 'vitest';
import type { Routine } from '../src/routines/model';
import { groupOf, sectionsOf } from '../src/routines/schedule';

const at = (y: number, m: number, d: number, h = 12, min = 0): number => new Date(y, m - 1, d, h, min).getTime();
/** Monday 28 September 2026, 10:00 local time: every date below is read against it. */
const NOW = at(2026, 9, 28, 10, 0);

const routine = (over: Partial<Routine> = {}): Routine => ({
  id: 'r',
  name: 'R',
  enabled: true,
  cron: '0 6 * * *',
  fired: false,
  repos: [],
  ...over,
});

describe('groupOf', () => {
  it('files a routine by the local day of its next run', () => {
    expect(groupOf(routine({ nextRunAt: at(2026, 9, 28, 23, 59) }), NOW)).toBe('today');
    expect(groupOf(routine({ nextRunAt: at(2026, 9, 29, 0, 1) }), NOW)).toBe('tomorrow');
    expect(groupOf(routine({ nextRunAt: at(2026, 10, 4, 9) }), NOW)).toBe('week');
    expect(groupOf(routine({ nextRunAt: at(2026, 10, 5, 9) }), NOW)).toBe('later');
  });

  it('puts a run due ten minutes after midnight under Tomorrow, even seen at 23:50', () => {
    expect(groupOf(routine({ nextRunAt: at(2026, 9, 29, 0, 10) }), at(2026, 9, 28, 23, 50))).toBe('tomorrow');
  });

  it('reads an overdue run as today: it is about to happen', () => {
    expect(groupOf(routine({ nextRunAt: at(2026, 9, 27, 6) }), NOW)).toBe('today');
  });

  it('files paused routines and spent one-shots under Paused, whatever date the server still gives them', () => {
    expect(groupOf(routine({ enabled: false, nextRunAt: at(2026, 9, 29, 6) }), NOW)).toBe('paused');
    expect(
      groupOf(routine({ cron: undefined, enabled: false, fired: true, nextRunAt: at(2026, 9, 28, 17) }), NOW),
    ).toBe('paused');
  });

  it('files an active routine with no next run under Later', () => {
    expect(groupOf(routine({ nextRunAt: undefined }), NOW)).toBe('later');
  });
});

describe('sectionsOf', () => {
  it('lists the groups in view order, empty ones left out', () => {
    const sections = sectionsOf(
      [
        routine({ id: 'p', enabled: false }),
        routine({ id: 'l', nextRunAt: at(2026, 11, 1) }),
        routine({ id: 't', nextRunAt: at(2026, 9, 28, 14) }),
      ],
      NOW,
    );
    expect(sections.map((s) => s.group)).toEqual(['today', 'later', 'paused']);
  });

  it('sorts by next run within a group, and by name among the paused', () => {
    const [today, paused] = sectionsOf(
      [
        routine({ id: 'late', name: 'A', nextRunAt: at(2026, 9, 28, 18) }),
        routine({ id: 'soon', name: 'B', nextRunAt: at(2026, 9, 28, 11) }),
        routine({ id: 'z', name: 'Zeta', enabled: false }),
        routine({ id: 'a', name: 'alpha', enabled: false }),
      ],
      NOW,
    );
    expect(today?.routines.map((r) => r.id)).toEqual(['soon', 'late']);
    expect(paused?.routines.map((r) => r.id)).toEqual(['a', 'z']);
  });

  it('gives nothing for no routine', () => {
    expect(sectionsOf([], NOW)).toEqual([]);
  });
});
