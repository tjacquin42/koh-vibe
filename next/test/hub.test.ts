import { describe, expect, it } from 'vitest';
import { contentKey, Hub, type Client } from '../src/host/hub';
import type { HostMessage, Snapshot } from '../src/shared/protocol';

const snap = (at: number): Snapshot => ({ at, sessions: [], folders: [], unfiled: [], artifacts: undefined, routines: undefined, closed: [], settings: { animate: true, persistent: true, expireTemporary: true, volume: 50 } });

function client(): Client & { got: HostMessage[] } {
  const got: HostMessage[] = [];
  return { got, context: { surface: 'sidebar', language: 'en', version: '0', launch: 'l', languageChoice: 'auto' }, post: (m) => got.push(m) };
}

function hub(build: () => Promise<Snapshot>) {
  let trigger: () => void = () => undefined;
  let disposed = false;
  const logs: string[] = [];
  const h = new Hub({
    build,
    watch: (onChange) => {
      trigger = onChange;
      return { dispose: () => (disposed = true) };
    },
    log: (m) => logs.push(m),
  });
  return { h, logs, change: () => trigger(), isWatcherDisposed: () => disposed };
}

describe('Hub', () => {
  it('sends init first, then snapshots', async () => {
    let n = 0;
    const { h } = hub(async () => ({ ...snap(++n), unfiled: [String(n)] }));
    const c = client();
    await h.attach(c);
    await h.refresh();
    expect(c.got.map((m) => m.type)).toEqual(['init', 'snapshot']);
    expect(c.got[0]?.type === 'init' && c.got[0].snapshot.at).toBe(1);
  });

  it('gives a late view the snapshot already built, without rebuilding', async () => {
    let builds = 0;
    const { h } = hub(async () => snap(++builds));
    await h.attach(client());
    const late = client();
    await h.attach(late);
    expect(builds).toBe(1);
    expect(late.got.map((m) => m.type)).toEqual(['init']);
  });

  it('coalesces a burst of changes into one extra build', async () => {
    let builds = 0;
    let release: () => void = () => undefined;
    const { h } = hub(
      () =>
        new Promise<Snapshot>((resolve) => {
          builds++;
          release = () => resolve(snap(builds));
        }),
    );
    const first = h.refresh();
    void h.refresh();
    void h.refresh();
    void h.refresh();
    release();
    await new Promise((r) => setTimeout(r, 0));
    release();
    await first;
    expect(builds).toBe(2);
  });

  it('keeps the last good snapshot when a build fails, and logs it', async () => {
    let fail = false;
    const { h, logs } = hub(async () => {
      if (fail) throw new Error('disk gone');
      return snap(1);
    });
    await h.refresh();
    fail = true;
    await h.refresh();
    expect(h.current?.at).toBe(1);
    expect(logs).toEqual(['snapshot failed: disk gone']);
  });

  it('inits a view that attached while no build had succeeded yet', async () => {
    let fail = true;
    const { h } = hub(async () => {
      if (fail) throw new Error('not yet');
      return snap(7);
    });
    const c = client();
    await h.attach(c);
    expect(c.got).toEqual([]);
    fail = false;
    await h.refresh();
    expect(c.got.map((m) => m.type)).toEqual(['init']);
  });

  it('stops posting to a detached view, and stops watching once disposed', async () => {
    const { h, isWatcherDisposed } = hub(async () => snap(1));
    const c = client();
    const handle = await h.attach(c);
    handle.dispose();
    await h.refresh();
    expect(c.got).toHaveLength(1);
    h.dispose();
    expect(isWatcherDisposed()).toBe(true);
  });

  it('does not send again a build that found nothing new: the views are only told it ended (16/11)', async () => {
    let n = 0;
    let said = 'a';
    const { h } = hub(async () => ({ ...snap(++n), unfiled: [said] }));
    const c = client();
    const heard: number[] = [];
    await h.attach(c);
    h.subscribe((s) => heard.push(s.at));
    // The same list, built at another moment: nothing to draw again.
    await h.refresh();
    await h.refresh();
    expect(c.got.map((m) => m.type)).toEqual(['init', 'steady', 'steady']);
    expect(heard).toEqual([1]);
    said = 'b';
    await h.refresh();
    expect(c.got.map((m) => m.type)).toEqual(['init', 'steady', 'steady', 'snapshot']);
    expect(heard).toEqual([1, 4]);
    // A view that arrives now still gets the whole of it, and the latest.
    const late = client();
    await h.attach(late);
    expect(late.got.map((m) => (m.type === 'init' ? m.snapshot.at : m.type))).toEqual([4]);
  });

  it('takes two builds for the same when only the moments they were read at differ', () => {
    const tokens = { input: 1, output: 1, cacheWrite: 0, cacheRead: 0 };
    const row = { id: 'a', project: 'p', tokens, subagentTokens: tokens, subagents: 0, busy: [], tail: [], lastAt: 5 };
    const built = (at: number, lastAt = 5): Snapshot => ({
      ...snap(at),
      activity: { at, since: at - 1_000, sessions: [{ ...row, lastAt }], feed: [] },
      processes: { at, bySession: { a: [{ pid: 7, label: 'vite', kind: 'work', elapsed: 30, rss: 1, depth: 0 }] } },
    });
    expect(contentKey(built(1))).toBe(contentKey(built(2)));
    // What a view shows did change: not the same.
    expect(contentKey(built(1))).not.toBe(contentKey(built(1, 6)));
    expect(contentKey(built(1))).not.toBe(contentKey({ ...built(1), processes: { at: 1, bySession: {} } }));
  });
});
