import { describe, expect, it } from 'vitest';
import { SIDEBAR_TABS, type ArtifactView, type RoutineView } from '../src/shared/protocol';
import { moveBefore, normalizeOrder } from '../view/src/order';
import { sampleSnapshot } from '../view/src/fixture';
import { countsOf, fold, folderIndex, formatWhen, isFiled, megabytes, UNFILED } from '../view/src/format';
import { translator } from '../view/src/i18n';
import { isEmpty, search } from '../view/src/search';
import { atLaunch, DEFAULT_UI, parseUiState, setFolds, toggleFold } from '../view/src/ui-state';
import { activeSessionId, FIVE_HOURS_MS, gaugeOf, pacePercent, revealStep, WEEK_MS } from '../view/src/sections';
import { answered, expire, MAX_MS, onSnapshot, startBusy } from '../view/src/busy';
import {
  artifactSections,
  boardColumns,
  countTokens,
  dropOrder,
  sortSessions,
  hourTicks,
  RECENT_COUNT,
  routineSections,
  timelineLanes,
  dropsInto,
  projectOrder,
  usageLines,
  inTone,
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
    expect(parseUiState({ tab: 'usage', folded: ['a', 3] })).toEqual({ tab: 'usage', folded: ['a'], cockpit: DEFAULT_UI.cockpit, showUsage: true, sort: 'status', archives: 10, spendWindow: '5h', tabOrder: DEFAULT_UI.tabOrder, viewOrder: DEFAULT_UI.viewOrder });
    expect(parseUiState({ cockpit: { view: 'wall', folder: 'f1', spanH: 24 } }).cockpit).toEqual({ view: 'wall', folder: 'f1', spanH: 24 });
    expect(parseUiState({ cockpit: { view: 'x', folder: 3, count: 'y', spanH: 5 } }).cockpit).toEqual(DEFAULT_UI.cockpit);
  });

  it('keeps the window of the hungriest conversations as last picked (16/11)', () => {
    expect(parseUiState({}).spendWindow).toBe('5h');
    expect(parseUiState({ spendWindow: '7d' }).spendWindow).toBe('7d');
    expect(parseUiState({ spendWindow: '1y' }).spendWindow).toBe('5h');
  });

  it('shows 10, 20 or 50 archives, 10 by default and for anything else (15/11)', () => {
    expect(parseUiState({}).archives).toBe(10);
    expect(parseUiState({ archives: 50 }).archives).toBe(50);
    expect(parseUiState({ archives: 30 }).archives).toBe(10);
  });

  it('toggles a fold', () => {
    const s = toggleFold(DEFAULT_UI, 'f1');
    expect(s.folded).toContain('f1');
    expect(toggleFold(s, 'f1').folded).not.toContain('f1');
  });

  it('folds and unfolds several sections at once, leaving the others as they are', () => {
    const base = { ...DEFAULT_UI, folded: ['closed', 'proc:a'] };
    expect(setFolds(base, ['proc:a', 'proc:b'], true).folded).toEqual(['closed', 'proc:a', 'proc:b']);
    expect(setFolds(base, ['proc:a', 'proc:b'], false).folded).toEqual(['closed']);
    // Nothing to change: the same state, so nothing renders for nothing.
    expect(setFolds(base, ['proc:a'], true)).toBe(base);
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

  it('shows a folder made by hand though it holds nothing, in its place among the projects (16/11)', () => {
    const items = [a('r1', { project: 'alpha' }), a('r2'), a('r3', { project: 'zed' })];
    const s = artifactSections(items, ['Beta', 'alpha']);
    expect(s.projects.map((p) => [p.project, p.items.length])).toEqual([
      ['alpha', 1],
      ['Beta', 0],
      ['zed', 1],
      [undefined, 1],
    ]);
    // With nothing at all on claude.ai's list, the folders still show.
    expect(artifactSections([], ['Veille']).projects).toEqual([{ project: 'Veille', items: [] }]);
  });

  it('puts the projects in the order they were dragged into, the others after by name, « Other » last (21/11)', () => {
    const items = [a('r1', { project: 'alpha' }), a('r2'), a('r3', { project: 'zed' }), a('r4', { project: 'Beta' })];
    expect(artifactSections(items, ['Veille'], ['zed', 'Veille', 'gone']).projects.map((p) => p.project)).toEqual(['zed', 'Veille', 'alpha', 'Beta', undefined]);
  });

  it('moves a dropped project before or after the one it lands on, or after them all', () => {
    const list = ['a', 'b', 'c', 'd'];
    expect(projectOrder(list, 'a', 'c', false)).toEqual(['b', 'a', 'c', 'd']);
    expect(projectOrder(list, 'a', 'c', true)).toEqual(['b', 'c', 'a', 'd']);
    expect(projectOrder(list, 'd', 'a', false)).toEqual(['d', 'a', 'b', 'c']);
    expect(projectOrder(list, 'b', 'd', true)).toEqual(['a', 'c', 'd', 'b']);
    expect(projectOrder(list, 'a', undefined, false)).toEqual(['b', 'c', 'd', 'a']);
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
    expect([all.wait, all.run, all.done, all.rest].map((c) => c.map((s) => s.id))).toEqual([['s1'], ['s2'], ['s3'], ['s4', 's5', 's6', 's7']]);
    const backend = boardColumns(snap, 'f2');
    expect([backend.wait, backend.run, backend.rest].map((c) => c.map((s) => s.id))).toEqual([[], ['s2'], ['s5']]);
    expect(boardColumns(snap, 'unfiled').rest.map((s) => s.id)).toEqual(['s4']);
  });

  it('C: what waits for you, the latest asked on top — never a closed one', () => {
    const first = snap.sessions[0]!;
    const two = { ...snap, sessions: [...snap.sessions, { ...first, id: 'older', lastEventAt: -1e9 }, { ...first, id: 'gone', endedAt: 5 }] };
    expect(inTone(two.sessions, 'wait').map((s) => s.id)).toEqual(['s1', 'older']);
  });

  it('counts tokens three ways', () => {
    const t = { input: 10, output: 20, cacheWrite: 70, cacheRead: 1000 };
    expect((['fresh', 'all', 'weighted'] as const).map((m) => countTokens(t, m))).toEqual([100, 1100, 200]);
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

describe('busy rows', () => {
  it('stays busy until answered and the next snapshot is in', () => {
    let b = startBusy(new Map(), 'a', 0, 2_000);
    b = onSnapshot(b);
    expect(b.has('a')).toBe(true);
    b = answered(b, 'a', 100);
    expect(b.has('a')).toBe(true);
    expect(onSnapshot(b).has('a')).toBe(false);
  });

  it('gives up after the hold when no snapshot comes, and after a minute in all', () => {
    const b = answered(startBusy(new Map(), 'a', 0, 2_000), 'a', 100);
    expect(expire(b, 1_000).has('a')).toBe(true);
    expect(expire(b, 2_200).has('a')).toBe(false);
    expect(expire(startBusy(new Map(), 'x', 0, 2_000), MAX_MS + 1).has('x')).toBe(false);
  });
});

describe('a new start of the extension', () => {
  it('folds every folder once, then leaves them be under the same start', () => {
    const opened = { ...DEFAULT_UI, folded: ['closed'], launch: 'old' };
    const fresh = atLaunch(opened, 'new', ['f1', 'f2']);
    expect(fresh.folded.sort()).toEqual(['closed', 'f1', 'f2', 'unfiled']);
    expect(fresh.launch).toBe('new');
    const reopened = toggleFold(fresh, 'f1');
    expect(atLaunch(reopened, 'new', ['f1', 'f2'])).toBe(reopened);
  });
});

describe('sortSessions', () => {
  const base = sampleSnapshot(0).sessions[0]!;
  const s = (id: string, status: 'running' | 'waiting' | 'done_unseen' | 'idle', lastEventAt: number) => ({ ...base, id, status, lastEventAt });
  const list = [s('a', 'idle', 30), s('b', 'waiting', 10), s('c', 'running', 20), s('d', 'waiting', 40)];
  it('keeps the hand-made order, or sorts by recency, or by what needs you first', () => {
    expect(sortSessions(list, 'manual').map((x) => x.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(sortSessions(list, 'recent').map((x) => x.id)).toEqual(['d', 'a', 'c', 'b']);
    expect(sortSessions(list, 'status').map((x) => x.id)).toEqual(['d', 'b', 'c', 'a']);
    expect(list.map((x) => x.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('keeps the working ones in their order whatever their last action (15/11)', () => {
    const working = [s('x', 'running', 10), s('y', 'running', 90), s('z', 'running', 50), s('w', 'waiting', 5)];
    expect(sortSessions(working, 'status').map((x) => x.id)).toEqual(['w', 'x', 'y', 'z']);
  });
});

describe('tab and view order', () => {
  it('reads a saved order against the full list: unknown dropped, doubles once, missing at the end', () => {
    expect(normalizeOrder(['usage', 'nope', 'usage', 'sessions'], SIDEBAR_TABS)).toEqual(['usage', 'sessions', 'artifacts', 'routines', 'processes']);
    expect(normalizeOrder('broken', SIDEBAR_TABS)).toEqual([...SIDEBAR_TABS]);
    expect(parseUiState({ tabOrder: ['artifacts'] }).tabOrder[0]).toBe('artifacts');
    expect(parseUiState({ viewOrder: ['nope', 'feed'] }).viewOrder).toEqual(['feed', 'board', 'wall', 'timeline', 'usage']);
  });

  it('moves an item in front of another, or to the end', () => {
    expect(moveBefore(['a', 'b', 'c', 'd'], 'd', 'b')).toEqual(['a', 'd', 'b', 'c']);
    expect(moveBefore(['a', 'b', 'c', 'd'], 'a', 'd')).toEqual(['b', 'c', 'a', 'd']);
    expect(moveBefore(['a', 'b', 'c', 'd'], 'b', undefined)).toEqual(['a', 'c', 'd', 'b']);
  });
});

describe('the conversation in front', () => {
  const snap = { ...sampleSnapshot(0) };
  delete snap.activeTab;
  const with_ = (activeTab: { label: string; sessionId?: string } | undefined) => ({ ...snap, ...(activeTab === undefined ? {} : { activeTab }) });
  const s1 = snap.sessions.find((s) => s.id === 's1');

  it('is the one the editor names, else the one open conversation of that title', () => {
    expect(activeSessionId(with_({ label: 'whatever', sessionId: 's2' }))).toBe('s2');
    expect(activeSessionId(with_({ label: s1?.title ?? '' }))).toBe('s1');
    expect(activeSessionId(with_({ label: 'Nothing has this title' }))).toBeUndefined();
    expect(activeSessionId(with_(undefined))).toBeUndefined();
  });

  it('is the newest with nothing written yet, for a tab still untitled', () => {
    const fresh = snap.sessions.filter((s) => s.fresh === true && s.endedAt === undefined).sort((a, b) => b.lastEventAt - a.lastEventAt);
    expect(activeSessionId(with_({ label: 'Claude Code' }))).toBe(fresh[0]?.id);
  });
});

describe('the pace mark (15/11)', () => {
  it('stands where the use should be at most by now: the share of the window gone', () => {
    const now = 1_000_000_000;
    // A 5-hour limit reset in 2.5 hours: half way.
    expect(pacePercent(now + 2.5 * 3_600_000, FIVE_HOURS_MS, now)).toBe(50);
    // A week reset in a day: six sevenths gone.
    expect(Math.round(pacePercent(now + 24 * 3_600_000, WEEK_MS, now) ?? 0)).toBe(86);
    expect(pacePercent(now + 10 * 3_600_000, FIVE_HOURS_MS, now)).toBe(0);
    expect(pacePercent(undefined, FIVE_HOURS_MS, now)).toBeUndefined();
    expect(pacePercent(now - 1, FIVE_HOURS_MS, now)).toBeUndefined();
  });
});

describe('a limit as its bar shows it', () => {
  const now = 1_000_000_000;
  it('rounds the percentage and keeps it within the bar', () => {
    expect(gaugeOf({ percent: 41.6 }, now).percent).toBe(42);
    expect(gaugeOf({ percent: 140 }, now).percent).toBe(100);
    expect(gaugeOf({ percent: -3 }, now).percent).toBe(0);
  });

  it('turns amber from 85 %', () => {
    expect(gaugeOf({ percent: 84.4 }, now).tone).toBe('run');
    expect(gaugeOf({ percent: 84.5 }, now).tone).toBe('wait');
  });

  it('gives a reset only while it is still ahead', () => {
    expect(gaugeOf({ percent: 10, resetsAt: now + 1 }, now).resetsAt).toBe(now + 1);
    expect(gaugeOf({ percent: 10, resetsAt: now }, now).resetsAt).toBeUndefined();
    expect(gaugeOf({ percent: 10 }, now).resetsAt).toBeUndefined();
  });
});

describe('where each conversation is filed', () => {
  const snap = sampleSnapshot(0);
  const where = folderIndex(snap);

  it('names the folder of every listed conversation, and the unfiled list for the rest', () => {
    expect(where.get('s1')).toBe('f1');
    expect(where.get('s2')).toBe('f2');
    expect(where.get('s4')).toBe(UNFILED);
    expect(where.get('nowhere')).toBeUndefined();
    expect(where.size).toBe(snap.sessions.length);
  });

  it('counts as filed only what a folder holds — only those can be put to sleep', () => {
    expect(isFiled(where, 's1')).toBe(true);
    expect(isFiled(where, 's4')).toBe(false);
    expect(isFiled(where, 'nowhere')).toBe(false);
  });

  it('counts a folder’s open conversations by state, as the cockpit does for the one chosen', () => {
    const inFolder = (folder: string) => snap.sessions.filter((s) => where.get(s.id) === folder);
    expect(countsOf(inFolder('f1'))).toEqual({ waiting: 1, running: 0, done: 1 });
    // Backend holds one that works and one asleep, which counts for nothing.
    expect(countsOf(inFolder('f2'))).toEqual({ waiting: 0, running: 1, done: 0 });
    expect(countsOf(inFolder(UNFILED))).toEqual({ waiting: 0, running: 0, done: 0 });
    expect(countsOf([])).toEqual({ waiting: 0, running: 0, done: 0 });
  });
});

describe('a state kept by an older version', () => {
  it('is read without what the view no longer keeps — the separators’ sizes, the old fold of the archives', () => {
    const old = parseUiState({ tab: 'artifacts', folded: ['closed', 'f1'], sizes: { 'ck.side': 320 }, titleLines: 1, tabNames: false });
    expect(old).toEqual({ ...DEFAULT_UI, tab: 'artifacts', folded: ['closed', 'f1'] });
    expect('sizes' in old).toBe(false);
    // Nothing is folded to begin with: the archives open, under their own key.
    expect(DEFAULT_UI.folded).toEqual([]);
  });
});

describe('an artifact dropped on a project (16/11)', () => {
  it('moves only when the project is another one — « Other » being the project of those that have none', () => {
    expect(dropsInto('api', 'shop-front')).toBe(true);
    expect(dropsInto('api', undefined)).toBe(true);
    expect(dropsInto(undefined, 'api')).toBe(true);
    // Dropped where it already is: nothing to write.
    expect(dropsInto('api', 'api')).toBe(false);
    expect(dropsInto(undefined, undefined)).toBe(false);
  });
});

describe('revealStep: the conversation in front brought into sight (21/11)', () => {
  it('goes to a new conversation once, in its folder — not first at the bottom, in no folder', () => {
    // Asked for in folder g: it shows up first in no folder, while the ask is under way.
    expect(revealStep(undefined, 'n', 'unfiled', true)).toBeUndefined();
    expect(revealStep(undefined, 'n', undefined, true)).toBeUndefined();
    const filed = revealStep(undefined, 'n', 'g', true);
    expect(filed).toEqual({ key: 'n\ng', reveal: true });
    expect(revealStep(filed?.key, 'n', 'g', false)).toBeUndefined();
  });

  it('follows a conversation that leaves « no folder », not one moved by hand between folders', () => {
    const first = revealStep(undefined, 'a', 'unfiled', false);
    expect(first).toEqual({ key: 'a\n', reveal: true });
    expect(revealStep(first?.key, 'a', 'g', false)).toEqual({ key: 'a\ng', reveal: true });
    expect(revealStep('a\ng', 'a', 'h', false)).toEqual({ key: 'a\nh', reveal: false });
    // Another conversation in front: brought into sight wherever it is.
    expect(revealStep('a\ng', 'b', 'h', false)).toEqual({ key: 'b\nh', reveal: true });
  });
});
