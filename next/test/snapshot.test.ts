import { rm } from 'node:fs/promises';
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
    expect(snap.artifacts?.items).toEqual([{ slug: 'x', title: 'Plan', updatedAt: NOW - 2_000, pinned: true }]);
    expect(snap.routines?.items.map((r) => r.name)).toEqual(['Daily']);
    expect(snap.closed.map((c) => c.project)).toEqual(['old']);
  });

  it('renders an empty snapshot from a directory that does not exist', async () => {
    const snap = await buildSnapshot(`${home}/missing`, NOW);
    expect(snap).toMatchObject({ sessions: [], folders: [], unfiled: [], artifacts: undefined, routines: undefined, closed: [] });
    expect(snap.usage).toBeUndefined();
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
