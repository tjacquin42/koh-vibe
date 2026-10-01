import { describe, expect, it } from 'vitest';
import { isRoutine, parseRoutines, repoNameOf, routineUrl } from '../src/routines/model';

/** The shape the list endpoint returns, trimmed to what matters, with invented values. */
const trigger = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'trig_test_01',
  name: 'Morning digest',
  enabled: true,
  cron_expression: '0 6 * * *',
  next_run_at: '2026-09-28T06:02:11.819628769Z',
  ended_reason: '',
  created_at: '2026-09-01T10:00:00.000000Z',
  job_config: {
    ccr: {
      environment_id: 'env_test',
      session_context: {
        model: 'claude-sonnet-5',
        sources: [{ git_repository: { url: 'https://github.com/example/digest' } }],
      },
    },
  },
  ...over,
});

describe('parseRoutines', () => {
  it('reads the shape the endpoint returns', () => {
    expect(parseRoutines({ data: [trigger()], has_more: false })).toEqual({
      routines: [
        {
          id: 'trig_test_01',
          name: 'Morning digest',
          enabled: true,
          cron: '0 6 * * *',
          runOnceAt: undefined,
          nextRunAt: Date.parse('2026-09-28T06:02:11.819Z'),
          fired: false,
          repos: ['example/digest'],
        },
      ],
      truncated: false,
    });
  });

  it('reads a one-shot, and knows one that already fired', () => {
    const [due, spent] = parseRoutines({
      data: [
        trigger({ id: 'a', cron_expression: '', run_once_at: '2026-09-30T07:30:00Z' }),
        trigger({
          id: 'b',
          cron_expression: '',
          run_once_at: '2026-09-27T17:34:00Z',
          enabled: false,
          ended_reason: 'run_once_fired',
        }),
      ],
    })!.routines;
    expect(due).toMatchObject({ cron: undefined, runOnceAt: Date.parse('2026-09-30T07:30:00Z'), fired: false });
    expect(spent).toMatchObject({ enabled: false, fired: true });
  });

  it('skips a row it cannot read rather than losing the whole list', () => {
    const list = parseRoutines({
      data: [trigger({ id: 'kept' }), trigger({ id: '' }), trigger({ id: 'x', enabled: 'yes' }), null, 'nope'],
    });
    expect(list?.routines.map((r) => r.id)).toEqual(['kept']);
  });

  it('folds a name written on several lines, and falls back to the id when there is none', () => {
    const [multi, blank] = parseRoutines({
      data: [trigger({ id: 'a', name: '  Morning\n  digest\t ' }), trigger({ id: 'b', name: '   ' })],
    })!.routines;
    expect(multi?.name).toBe('Morning digest');
    expect(blank?.name).toBe('b');
  });

  it('says when the server held routines back', () => {
    expect(parseRoutines({ data: [], has_more: true })?.truncated).toBe(true);
  });

  it('returns undefined for a body that is not the list', () => {
    for (const body of [undefined, null, [], {}, { data: 'x' }, '{"data":[]}']) {
      expect(parseRoutines(body)).toBeUndefined();
    }
  });

  it('reads an unreadable date as no date', () => {
    expect(parseRoutines({ data: [trigger({ next_run_at: 'soon' })] })?.routines[0]?.nextRunAt).toBeUndefined();
  });
});

describe('repoNameOf', () => {
  it('keeps owner/name of a repository URL', () => {
    expect(repoNameOf('https://github.com/example/digest')).toBe('example/digest');
    expect(repoNameOf('https://github.com/example/digest.git')).toBe('example/digest');
    expect(repoNameOf('https://github.com/example/digest/')).toBe('example/digest');
  });

  it('shows anything else as given, and nothing for nothing', () => {
    expect(repoNameOf('git@example.org:team/tool')).toBe('git@example.org:team/tool');
    expect(repoNameOf('')).toBeUndefined();
    expect(repoNameOf(42)).toBeUndefined();
  });
});

describe('isRoutine', () => {
  it('accepts a routine as the cache writes it back', () => {
    const [r] = parseRoutines({ data: [trigger()] })!.routines;
    expect(isRoutine(JSON.parse(JSON.stringify(r)))).toBe(true);
  });

  it('refuses what a routine is not', () => {
    for (const v of [
      null,
      {},
      { id: 'a', name: 'b', enabled: 'yes', fired: false, repos: [] },
      { id: 'a', name: 'b', enabled: true, fired: false, repos: [1] },
      { id: 'a', name: 'b', enabled: true, fired: false, repos: [], cron: 5 },
    ]) {
      expect(isRoutine(v)).toBe(false);
    }
  });
});

describe('routineUrl', () => {
  it('points at the routine on claude.ai, the id escaped', () => {
    expect(routineUrl('trig_test_01')).toBe('https://claude.ai/code/routines/trig_test_01');
    expect(routineUrl('a/b')).toBe('https://claude.ai/code/routines/a%2Fb');
  });
});
