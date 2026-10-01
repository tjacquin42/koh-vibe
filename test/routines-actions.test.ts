import { describe, expect, it } from 'vitest';
import { launchRoutine, pauseRoutine, type RoutineCalls, type RoutineUi } from '../src/routines/actions';
import type { Routine } from '../src/routines/model';

const routine = (over: Partial<Routine> = {}): Routine => ({
  id: 'trig_test_01',
  name: 'Digest',
  enabled: true,
  cron: '0 6 * * *',
  fired: false,
  repos: [],
  ...over,
});

/** Records every call in order, so a test asserts the sequence and not only the result. */
function harness(opts: { confirm?: boolean; ok?: boolean } = {}) {
  const log: string[] = [];
  const calls: RoutineCalls = {
    run: async (id) => {
      log.push(`run ${id}`);
      return opts.ok ?? true;
    },
    setEnabled: async (id, enabled) => {
      log.push(`enable ${id} ${enabled}`);
      return opts.ok ?? true;
    },
    refresh: async () => {
      log.push('refresh');
    },
  };
  const ui: RoutineUi = {
    confirmRun: async (r) => {
      log.push(`confirm ${r.name}`);
      return opts.confirm ?? true;
    },
    done: (message) => {
      log.push(`done ${message}`);
    },
    launched: (r) => {
      log.push(`launched ${r.name}`);
    },
    failed: (message) => {
      log.push(`failed ${message}`);
    },
  };
  return { calls, ui, log };
}

describe('launchRoutine', () => {
  it('asks first, then runs, says so, and reads the list again', async () => {
    const h = harness();
    expect(await launchRoutine(routine(), h.calls, h.ui)).toBe('launched');
    expect(h.log).toEqual(['confirm Digest', 'run trig_test_01', 'launched Digest', 'refresh']);
  });

  it('does nothing at all when the confirmation is declined', async () => {
    const h = harness({ confirm: false });
    expect(await launchRoutine(routine(), h.calls, h.ui)).toBe('cancelled');
    expect(h.log).toEqual(['confirm Digest']);
  });

  it('says it failed, and still reads the list again', async () => {
    const h = harness({ ok: false });
    expect(await launchRoutine(routine(), h.calls, h.ui)).toBe('failed');
    expect(h.log).toEqual(['confirm Digest', 'run trig_test_01', 'failed Could not launch “Digest”.', 'refresh']);
  });

  it('never runs a paused routine or a spent one-shot, even from a stale row', async () => {
    for (const r of [routine({ enabled: false }), routine({ cron: undefined, enabled: false, fired: true })]) {
      const h = harness();
      expect(await launchRoutine(r, h.calls, h.ui)).toBe('cancelled');
      expect(h.log).toEqual([]);
    }
  });
});

describe('pauseRoutine', () => {
  it('pauses an active routine', async () => {
    const h = harness();
    expect(await pauseRoutine(routine(), true, h.calls, h.ui)).toBe('done');
    expect(h.log).toEqual(['enable trig_test_01 false', 'done Koh-Vibe: “Digest” paused', 'refresh']);
  });

  it('resumes a paused one', async () => {
    const h = harness();
    expect(await pauseRoutine(routine({ enabled: false }), false, h.calls, h.ui)).toBe('done');
    expect(h.log).toEqual(['enable trig_test_01 true', 'done Koh-Vibe: “Digest” resumed', 'refresh']);
  });

  it('leaves alone a routine already in that state', async () => {
    const h = harness();
    expect(await pauseRoutine(routine(), false, h.calls, h.ui)).toBe('skipped');
    expect(await pauseRoutine(routine({ enabled: false }), true, h.calls, h.ui)).toBe('skipped');
    expect(h.log).toEqual([]);
  });

  it('never resumes a one-shot that already fired', async () => {
    const h = harness();
    expect(await pauseRoutine(routine({ cron: undefined, enabled: false, fired: true }), false, h.calls, h.ui)).toBe('skipped');
    expect(h.log).toEqual([]);
  });

  it('says it failed, and still reads the list again', async () => {
    const h = harness({ ok: false });
    expect(await pauseRoutine(routine(), true, h.calls, h.ui)).toBe('failed');
    expect(h.log).toEqual(['enable trig_test_01 false', 'failed Could not pause “Digest”.', 'refresh']);
  });
});
