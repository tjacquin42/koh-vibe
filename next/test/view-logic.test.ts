import { describe, expect, it } from 'vitest';
import type { ArtifactView, RoutineView } from '../src/shared/protocol';
import { sampleSnapshot } from '../view/src/fixture';
import { fold, formatWhen, megabytes } from '../view/src/format';
import { translator } from '../view/src/i18n';
import { isEmpty, search } from '../view/src/search';
import { DEFAULT_UI, parseUiState, setSize, toggleFold } from '../view/src/ui-state';
import {
  artifactSections,
  boardColumns,
  COUNT_MODES,
  countTokens,
  dropOrder,
  hourTicks,
  inbox,
  projectTotals,
  RECENT_COUNT,
  routineSections,
  timelineLanes,
  usageLines,
} from '../view/src/sections';

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
    const back = { ...snap, closed: [{ sessionId: 's2', title: 'Fix the flaky date test', project: 'api', closedAt: 0, resumable: true }] };
    expect(search(back, 'flaky')?.closed).toEqual([]);
  });
});

describe('ui state', () => {
  it('falls back to the default on anything unreadable', () => {
    expect(parseUiState(undefined)).toEqual(DEFAULT_UI);
    expect(parseUiState({ tab: 'nope', folded: 'x' })).toEqual(DEFAULT_UI);
    expect(parseUiState({ tab: 'usage', folded: ['a', 3] })).toEqual({ tab: 'usage', folded: ['a'], cockpit: DEFAULT_UI.cockpit, sizes: {}, showUsage: true });
    expect(parseUiState({ cockpit: { view: 'wall', folder: 'f1', count: 'all', spanH: 24 } }).cockpit).toEqual({ view: 'wall', folder: 'f1', count: 'all', spanH: 24 });
    expect(parseUiState({ cockpit: { view: 'x', folder: 3, count: 'y', spanH: 5 } }).cockpit).toEqual(DEFAULT_UI.cockpit);
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
    spent: false,
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

describe('cockpit sections', () => {
  const snap = sampleSnapshot(0);

  it('A: sorts conversations into status columns, ended with the idle ones, and filters by folder', () => {
    const all = boardColumns(snap, undefined);
    expect([all.wait, all.run, all.done, all.rest].map((c) => c.map((s) => s.id))).toEqual([['s1'], ['s2'], ['s3'], ['s4', 's5']]);
    const backend = boardColumns(snap, 'f2');
    expect([backend.wait, backend.run, backend.rest].map((c) => c.map((s) => s.id))).toEqual([[], ['s2'], ['s5']]);
    expect(boardColumns(snap, 'unfiled').rest.map((s) => s.id)).toEqual(['s4']);
  });

  it('C: longest waiting first, then what finished unread', () => {
    const two = { ...snap, sessions: [...snap.sessions, { ...snap.sessions[0]!, id: 'older', lastEventAt: -1e9 }] };
    const box = inbox(two);
    expect(box.waiting.map((s) => s.id)).toEqual(['older', 's1']);
    expect(box.toRead.map((s) => s.id)).toEqual(['s3']);
  });

  it('H: counts three ways and totals per project, subagents included', () => {
    const t = { input: 10, output: 20, cacheWrite: 70, cacheRead: 1000 };
    expect(COUNT_MODES.map((m) => countTokens(t, m))).toEqual([100, 1100, 200]);
    const z = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 };
    const act = {
      at: 0,
      since: 0,
      feed: [],
      sessions: [
        { id: 'a', project: 'api', tokens: t, subagentTokens: t, subagents: 1, busy: [], tail: [], lastAt: 0 },
        { id: 'b', project: 'web', tokens: { ...z, output: 5 }, subagentTokens: z, subagents: 0, busy: [], tail: [], lastAt: 0 },
        { id: 'c', project: 'api', tokens: z, subagentTokens: z, subagents: 0, busy: [], tail: [], lastAt: 0 },
      ],
    };
    expect(projectTotals(act, 'fresh')).toEqual([
      { project: 'api', own: 100, subagents: 100, total: 200, sessions: 2 },
      { project: 'web', own: 5, subagents: 0, total: 5, sessions: 1 },
    ]);
  });

  it('G: clips stretches to the span and drops lanes with nothing inside', () => {
    const H = 3_600_000;
    const now = 10 * H;
    const lane = (id: string, busy: [number, number][]) => ({ id, project: 'p', tokens: { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 }, subagentTokens: { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 }, subagents: 0, busy, tail: [], lastAt: 0 });
    const lanes = timelineLanes({ at: now, since: 0, feed: [], sessions: [lane('in', [[5 * H, 7 * H], [9 * H, 11 * H]]), lane('out', [[0, H]])] }, now, 4 * H);
    expect(lanes.map((l) => l.session.id)).toEqual(['in']);
    // The span is 6 h → 10 h: the first stretch (5 h → 7 h) is cut to its last hour.
    expect(lanes[0]?.bars).toEqual([
      [0, 0.25],
      [0.75, 0.25],
    ]);
  });

  it('G: puts ticks on whole hours inside the span', () => {
    const now = new Date(2026, 10, 14, 15, 30).getTime();
    const ticks = hourTicks(now, 4 * 3_600_000, 1);
    expect(ticks.map(([, t]) => new Date(t).getHours())).toEqual([12, 13, 14, 15]);
    expect(ticks[0]?.[0]).toBeCloseTo(0.125);
  });
});

describe('dropOrder', () => {
  it('inserts in front of the target, or at the end', () => {
    expect(dropOrder(['a', 'b', 'c'], ['c'], 'a')).toEqual(['c', 'a', 'b']);
    expect(dropOrder(['a', 'b', 'c'], ['a'])).toEqual(['b', 'c', 'a']);
    expect(dropOrder(['a', 'b'], ['x'], 'b')).toEqual(['a', 'x', 'b']);
  });

  it('lands a drop on itself or on an unknown id at the end rather than losing it', () => {
    expect(dropOrder(['a', 'b'], ['a'], 'a')).toEqual(['b', 'a']);
    expect(dropOrder(['a', 'b'], ['x'], 'zz')).toEqual(['a', 'b', 'x']);
  });
});

describe('separator sizes', () => {
  it('keeps sane sizes, drops the rest, and resets one on demand', () => {
    const ui = parseUiState({ sizes: { 'ck.nav': 260.4, 'ck.side': 'wide', 'strip': 12, 'huge': 99_999 } });
    expect(ui.sizes).toEqual({ 'ck.nav': 260 });
    expect(setSize(ui, 'strip', 120).sizes).toEqual({ 'ck.nav': 260, strip: 120 });
    expect(setSize(ui, 'ck.nav', undefined).sizes).toEqual({});
  });
});
