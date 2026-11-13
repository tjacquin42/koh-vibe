import { describe, expect, it } from 'vitest';
import type { ArtifactView, RoutineView } from '../src/shared/protocol';
import { sampleSnapshot } from '../view/src/fixture';
import { fold, formatWhen, megabytes } from '../view/src/format';
import { translator } from '../view/src/i18n';
import { isEmpty, search } from '../view/src/search';
import { DEFAULT_UI, parseUiState, toggleFold } from '../view/src/ui-state';
import { artifactSections, RECENT_COUNT, routineSections, usageLines } from '../view/src/sections';

describe('search', () => {
  const snap = sampleSnapshot(0);

  it('is off for an empty or blank query', () => {
    expect(search(snap, '')).toBeUndefined();
    expect(search(snap, '   ')).toBeUndefined();
  });

  it('matches every word, in any order, across title, project and branch', () => {
    expect(search(snap, 'dates api')?.sessions.map((s) => s.id)).toEqual(['s2']);
    expect(search(snap, 'EXPORT')?.sessions.map((s) => s.id)).toEqual(['s1']);
    expect(search(snap, 'router')?.closed.map((c) => c.sessionId)).toEqual(['c1']);
    expect(search(snap, 'menu')?.artifacts.map((a) => a.slug)).toEqual(['a3']);
  });

  it('ignores accents and case', () => {
    expect(fold('Dépense Élevée')).toBe('depense elevee');
    const withAccent = { ...snap, artifacts: { at: 0, items: [{ slug: 'z', title: 'Plan de dépenses', pinned: false }] } };
    expect(search(withAccent, 'DEPENSES')?.artifacts).toHaveLength(1);
  });

  it('says when nothing matches', () => {
    const r = search(snap, 'zzz');
    expect(r !== undefined && isEmpty(r)).toBe(true);
  });

  it('shows a closed conversation that is back on the list only once', () => {
    const back = { ...snap, closed: [{ sessionId: 's2', title: 'Fix the flaky date test', project: 'api', closedAt: 0 }] };
    expect(search(back, 'flaky')?.closed).toEqual([]);
  });
});

describe('ui state', () => {
  it('falls back to the default on anything unreadable', () => {
    expect(parseUiState(undefined)).toEqual(DEFAULT_UI);
    expect(parseUiState({ tab: 'nope', folded: 'x' })).toEqual(DEFAULT_UI);
    expect(parseUiState({ tab: 'usage', folded: ['a', 3] })).toEqual({ tab: 'usage', folded: ['a'] });
  });

  it('toggles a fold', () => {
    const s = toggleFold(DEFAULT_UI, 'f1');
    expect(s.folded).toContain('f1');
    expect(toggleFold(s, 'f1').folded).not.toContain('f1');
  });
});

describe('artifact sections', () => {
  const a = (slug: string, extra: Partial<ArtifactView> = {}): ArtifactView => ({ slug, title: slug, pinned: false, ...extra });

  it('splits pinned, recent and by project, « Other » last', () => {
    const items = [a('p', { pinned: true, project: 'zed' }), a('r1', { project: 'alpha' }), a('r2'), a('r3', { project: 'Beta' })];
    const s = artifactSections(items);
    expect(s.pinned.map((x) => x.slug)).toEqual(['p']);
    expect(s.recent.map((x) => x.slug)).toEqual(['r1', 'r2', 'r3']);
    expect(s.projects.map((p) => p.project)).toEqual(['alpha', 'Beta', 'zed', undefined]);
  });

  it('caps the recent list', () => {
    const many = Array.from({ length: RECENT_COUNT + 3 }, (_, i) => a(`x${i}`));
    expect(artifactSections(many).recent).toHaveLength(RECENT_COUNT);
  });
});

describe('routine sections', () => {
  const r = (id: string, group: RoutineView['group'], nextRunAt?: number): RoutineView => ({
    id,
    name: id,
    enabled: group !== 'paused',
    group,
    repos: [],
    ...(nextRunAt === undefined ? {} : { nextRunAt }),
  });

  it('keeps V1’s order: groups by time, by next run inside, by name among the paused', () => {
    const s = routineSections([r('z', 'paused'), r('late', 'today', 9), r('early', 'today', 3), r('a', 'paused'), r('w', 'week', 50)]);
    expect(s.map((x) => [x.group, x.items.map((i) => i.id)])).toEqual([
      ['today', ['early', 'late']],
      ['week', ['w']],
      ['paused', ['a', 'z']],
    ]);
  });
});

describe('usage lines', () => {
  it('lists 5 hours, the week and every model window', () => {
    const fr = translator('fr');
    const u = sampleSnapshot(0).usage;
    if (u === undefined) throw new Error('fixture has usage');
    expect(usageLines(u, fr).map((l) => l.label)).toEqual(['5 heures', 'Semaine', 'Semaine · Opus']);
  });
});

describe('formatWhen and megabytes', () => {
  // Local-time arithmetic: build the dates in local time so the test holds in any zone.
  const at = (d: number, h: number, m = 0): number => new Date(2026, 10, d, h, m).getTime();

  it('gives the time today, the weekday within a week, the date beyond', () => {
    expect(formatWhen(at(14, 16, 5), at(14, 9), 'fr')).toBe('16:05');
    expect(formatWhen(at(16, 8), at(14, 9), 'fr')).toMatch(/^lun\.? 08:00$/);
    expect(formatWhen(at(28, 8), at(14, 9), 'fr')).toMatch(/^28 nov\.? 08:00$/);
  });

  it('rounds memory to whole megabytes, never zero', () => {
    expect(megabytes(10)).toBe(1);
    expect(megabytes(150_000)).toBe(146);
  });
});
