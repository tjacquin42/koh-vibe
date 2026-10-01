import { describe, expect, it } from 'vitest';
import type { Routine } from '../src/routines/model';
import { routineDescription, routineTooltip } from '../src/ui/routine-labels';

const at = (y: number, m: number, d: number, h = 12, min = 0): number => new Date(y, m - 1, d, h, min).getTime();
/** Monday 28 September 2026, 10:00 local time. */
const NOW = at(2026, 9, 28, 10, 0);
/** Intl may put a narrow or a plain no-break space where a test writes a space. */
const norm = (s: string): string => s.replace(/[  ]/g, ' ');

const routine = (over: Partial<Routine> = {}): Routine => ({
  id: 'r',
  name: 'R',
  enabled: true,
  cron: '0 6 * * *',
  fired: false,
  repos: [],
  ...over,
});

describe('routineDescription', () => {
  it('gives the hour today and tomorrow', () => {
    expect(norm(routineDescription(routine({ nextRunAt: at(2026, 9, 28, 6, 12) }), 'today', NOW, 'fr'))).toBe('06:12');
    expect(norm(routineDescription(routine({ nextRunAt: at(2026, 9, 29, 14, 52) }), 'tomorrow', NOW, 'fr'))).toBe('14:52');
  });

  it('gives the day and the hour within the week, the date past it', () => {
    expect(norm(routineDescription(routine({ nextRunAt: at(2026, 10, 1, 14, 52) }), 'week', NOW, 'fr'))).toBe('jeu. 14:52');
    expect(norm(routineDescription(routine({ nextRunAt: at(2026, 10, 12, 9) }), 'later', NOW, 'fr'))).toBe('12 oct.');
    expect(norm(routineDescription(routine({ nextRunAt: at(2027, 1, 1, 5) }), 'later', NOW, 'fr'))).toBe('1 janv. 2027');
  });

  it('marks a one-shot', () => {
    const once = routine({ cron: undefined, runOnceAt: at(2026, 9, 30, 9, 30), nextRunAt: at(2026, 9, 30, 9, 30) });
    expect(norm(routineDescription(once, 'week', NOW, 'fr'))).toBe('mer. 09:30 · once');
  });

  it('says what a paused routine would do, not a date it will never keep', () => {
    expect(routineDescription(routine({ enabled: false, nextRunAt: at(2026, 9, 29, 6) }), 'paused', NOW, 'fr')).toBe('0 6 * * *');
    const spent = routine({ cron: undefined, enabled: false, fired: true, runOnceAt: at(2026, 9, 27, 17, 34) });
    expect(norm(routineDescription(spent, 'paused', NOW, 'fr'))).toBe('ran 27 sept.');
    const parked = routine({ cron: undefined, enabled: false, runOnceAt: at(2026, 10, 3, 8) });
    expect(norm(routineDescription(parked, 'paused', NOW, 'fr'))).toBe('3 oct. · once');
  });

  it('says so when an active routine has no next run', () => {
    expect(routineDescription(routine({ nextRunAt: undefined }), 'later', NOW, 'fr')).toBe('no next run');
  });
});

describe('routineTooltip', () => {
  it('spells out the schedule, the next run and the repositories', () => {
    const text = norm(
      routineTooltip(routine({ name: 'Digest', nextRunAt: at(2026, 9, 29, 6, 2), repos: ['example/digest'] }), 'fr'),
    );
    expect(text.split('\n')).toEqual([
      'Digest',
      'Schedule: 0 6 * * * (cron, UTC)',
      'Next run: mardi 29 septembre 2026 à 06:02',
      'Repositories: example/digest',
      'Click to open on claude.ai',
    ]);
  });

  it('says a spent one-shot has nothing left to run', () => {
    const text = routineTooltip(
      routine({ cron: undefined, runOnceAt: at(2026, 9, 27, 17, 34), enabled: false, fired: true }),
      'fr',
    );
    expect(text).toContain('Already ran — nothing left to run');
    expect(text).not.toContain('Next run');
  });
});
