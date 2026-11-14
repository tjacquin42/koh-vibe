import { describe, expect, it } from 'vitest';
import { Hub, type Client } from '../src/host/hub';
import type { HostMessage, Snapshot } from '../src/shared/protocol';

const snap = (at: number): Snapshot => ({ at, sessions: [], folders: [], unfiled: [], artifacts: undefined, routines: undefined, closed: [], settings: { animate: true, persistent: true, expireTemporary: true, volume: 50 } });

function client(): Client & { got: HostMessage[] } {
  const got: HostMessage[] = [];
  return { got, context: { surface: 'sidebar', language: 'en', version: '0' }, post: (m) => got.push(m) };
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
    const { h } = hub(async () => snap(++n));
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
});
