import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildSnapshot, compareSessions, ordered } from '../src/host/snapshot';
import type { SessionView } from '../src/shared/protocol';
import { fingerprint, makeHome, NOW } from './home';

let home: string;
beforeEach(async () => {
  home = await makeHome();
});
afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

describe('buildSnapshot', () => {
  it('never writes to the state directory', async () => {
    const before = await fingerprint(home);
    await buildSnapshot(home, NOW);
    await buildSnapshot(home, NOW);
    expect(await fingerprint(home)).toBe(before);
  });

  it('lists visible sessions only, skipping hidden and unreadable files', async () => {
    const snap = await buildSnapshot(home, NOW);
    expect(snap.sessions.map((s) => s.id).sort()).toEqual(['a', 'b', 'c', 'e']);
  });

  it('calls « new » only an idle, untitled conversation with nothing run — once the transcripts are read', async () => {
    expect((await buildSnapshot(home, NOW)).sessions.some((s) => s.fresh === true)).toBe(false);
    const read = await buildSnapshot(home, NOW, { transcripts: new Map() });
    // c: idle, no tool, no title. a has a title, b waits, e has ended.
    expect(read.sessions.filter((s) => s.fresh === true).map((s) => s.id)).toEqual(['c']);
  });

  it('orders folders by their order, then sessions by the hand-picked order then the default sort', async () => {
    const snap = await buildSnapshot(home, NOW);
    expect(snap.folders.map((f) => f.id)).toEqual(['g1', 'g2']);
    // `a` was placed by hand; `b` follows; `ghost` is not a session and is dropped.
    expect(snap.folders[0]?.sessionIds).toEqual(['a', 'b']);
    expect(snap.folders[0]?.color).toBe('blue');
    expect(snap.folders[1]?.sessionIds).toEqual(['e']);
    expect(snap.unfiled).toEqual(['c']);
  });

  it('maps usage, cloud caches and closed conversations', async () => {
    const snap = await buildSnapshot(home, NOW);
    expect(snap.usage?.fiveHour?.percent).toBe(42);
    expect(snap.usage?.weekly?.percent).toBe(7);
    expect(snap.usage?.models).toEqual([{ name: 'Opus', percent: 61, resetsAt: Date.parse('2027-01-20T08:00:00+00:00') }]);
    expect(snap.artifacts?.items).toEqual([
      { slug: 'x', title: 'Plan', updatedAt: NOW - 2_000, pinned: true },
      { slug: 'y', title: 'Notes', updatedAt: NOW - 1_500, pinned: false, project: 'koh' },
    ]);
    expect(snap.routines?.items).toEqual([
      { id: 'r', name: 'Daily', enabled: true, group: 'today', cron: '0 7 * * *', repos: ['me/daily'], nextRunAt: NOW + 60 * 60_000, spent: false },
      { id: 'q', name: 'Paused one', enabled: false, group: 'paused', repos: [], spent: false },
    ]);
    // An SDK run has nothing to resume it from: V1 would only explain so.
    expect(snap.closed.map((c) => [c.project, c.resumable]).sort()).toEqual([
      ['batch', false],
      ['old', true],
    ]);
  });

  it('gives reset deadlines in milliseconds, not V1 seconds', async () => {
    const snap = await buildSnapshot(home, NOW);
    expect(snap.usage?.fiveHour?.resetsAt).toBe(Date.parse('2027-01-15T08:00:00+00:00'));
  });

  it('reads the shared settings', async () => {
    const snap = await buildSnapshot(home, NOW);
    expect(snap.settings).toEqual({ animate: false, persistent: true, expireTemporary: true, volume: 30 });
  });

  it('dates the departure of temporary conversations, and only theirs', async () => {
    const snap = await buildSnapshot(home, NOW);
    const by = new Map(snap.sessions.map((s) => [s.id, s]));
    // c is filed nowhere; a and b are in a folder; e is ended.
    expect(by.get('c')?.expiresAt).toBe(NOW - 60_000 + 24 * 3_600_000);
    expect(by.get('a')?.expiresAt).toBeUndefined();
    expect(by.get('e')?.expiresAt).toBeUndefined();
  });

  it('dates nothing when temporary conversations are kept', async () => {
    await writeFile(join(home, 'settings.json'), JSON.stringify({ version: 1, expireTemporary: false }));
    const snap = await buildSnapshot(home, NOW);
    expect(snap.sessions.some((s) => s.expiresAt !== undefined)).toBe(false);
  });

  it('asks for the processes with every listed conversation directory', async () => {
    let asked: readonly string[] = [];
    const snap = await buildSnapshot(home, NOW, {
      processes: async (cwds) => {
        asked = cwds;
        return { at: NOW, bySession: {} };
      },
    });
    expect([...asked].sort()).toEqual(['/work/a', '/work/b', '/work/c', '/work/e']);
    expect(snap.processes).toEqual({ at: NOW, bySession: {} });
  });

  it('renders an empty snapshot from a directory that does not exist', async () => {
    const snap = await buildSnapshot(`${home}/missing`, NOW);
    expect(snap).toMatchObject({ sessions: [], folders: [], unfiled: [], artifacts: undefined, routines: undefined, closed: [] });
    expect(snap.usage).toBeUndefined();
    expect(snap.settings.animate).toBe(true);
  });
});

describe('ordering', () => {
  const v = (id: string, extra: Partial<SessionView>): SessionView => ({
    id,
    project: 'p',
    status: 'idle',
    origin: 'vscode',
    toolCount: 0,
    lastEventAt: 0,
    ...extra,
  });

  it('puts waiting before running before finished before idle, ended last', () => {
    const list = [
      v('ended', { status: 'waiting', endedAt: 5 }),
      v('idle', { status: 'idle' }),
      v('done', { status: 'done_unseen' }),
      v('run', { status: 'running' }),
      v('wait', { status: 'waiting' }),
    ];
    expect(list.sort(compareSessions).map((s) => s.id)).toEqual(['wait', 'run', 'done', 'idle', 'ended']);
  });

  it('keeps a hand-picked order and appends the rest sorted', () => {
    const byId = new Map([v('x', { lastEventAt: 1 }), v('y', { lastEventAt: 3 }), v('z', { lastEventAt: 2 })].map((s) => [s.id, s]));
    expect(ordered(['x', 'y', 'z'], ['z', 'gone'], byId)).toEqual(['z', 'y', 'x']);
  });
});
