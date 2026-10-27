import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Feed, FEED_REFRESH_AFTER_MS, type Fetched } from '../src/cloud/feed';

type Item = { n: number };

const isItem = (v: unknown): v is Item =>
  typeof v === 'object' && v !== null && typeof (v as { n?: unknown }).n === 'number';

const ok = (...ns: number[]): Fetched<Item> => ({ kind: 'ok', items: ns.map((n) => ({ n })), truncated: false });

const fileIn = async (): Promise<string> => join(await mkdtemp(join(tmpdir(), 'koh-feed-')), 'feed.json');

/** A feed whose answers are scripted, one per request, the last one repeating. */
function scripted(file: string, answers: Array<Fetched<Item> | Error>, clock: { now: number }) {
  let calls = 0;
  const feed = new Feed<Item>(file, isItem, {
    fetch: async () => {
      const answer = answers[Math.min(calls, answers.length - 1)]!;
      calls += 1;
      if (answer instanceof Error) throw answer;
      return answer;
    },
    now: () => clock.now,
  });
  return { feed, calls: () => calls };
}

describe('a cloud feed', () => {
  it('shows a loading state until its first answer, then the list with its date', async () => {
    const clock = { now: 1_000 };
    const { feed } = scripted(await fileIn(), [ok(1, 2)], clock);
    expect(await feed.read()).toEqual({ kind: 'loading' });
    await feed.refresh(false);
    expect(await feed.read()).toEqual({
      kind: 'ready',
      snapshot: { at: 1_000, items: [{ n: 1 }, { n: 2 }], truncated: false },
    });
  });

  it('shares what it read with another window, which then asks nothing', async () => {
    const file = await fileIn();
    const clock = { now: 1_000 };
    await scripted(file, [ok(7)], clock).feed.refresh(false);
    const other = scripted(file, [ok(99)], clock);
    expect(await other.feed.read()).toMatchObject({ kind: 'ready', snapshot: { items: [{ n: 7 }] } });
    await other.feed.refresh(false);
    expect(other.calls()).toBe(0);
  });

  it('asks again only once the delay has passed', async () => {
    const clock = { now: 1_000 };
    const { feed, calls } = scripted(await fileIn(), [ok(1)], clock);
    await feed.refresh(false);
    await feed.refresh(false);
    clock.now += FEED_REFRESH_AFTER_MS - 1;
    await feed.refresh(false);
    expect(calls()).toBe(1);
    clock.now += 1;
    await feed.refresh(false);
    expect(calls()).toBe(2);
  });

  it('counts a failure as an attempt: signed out, it does not ask on every render', async () => {
    const { feed, calls } = scripted(await fileIn(), [{ kind: 'signed-out' }], { now: 1_000 });
    for (let i = 0; i < 5; i++) await feed.refresh(false);
    expect(calls()).toBe(1);
    expect(await feed.read()).toEqual({ kind: 'signed-out' });
  });

  it('keeps showing the last list, with its date, when a later read fails', async () => {
    const clock = { now: 1_000 };
    const { feed, calls } = scripted(await fileIn(), [ok(1), { kind: 'signed-out' }], clock);
    await feed.refresh(false);
    clock.now += FEED_REFRESH_AFTER_MS;
    await feed.refresh(false);
    expect(calls()).toBe(2);
    expect(await feed.read()).toEqual({ kind: 'ready', snapshot: { at: 1_000, items: [{ n: 1 }], truncated: false } });
  });

  it('asks right away when forced — the refresh button, or the re-read after an action', async () => {
    const { feed, calls } = scripted(await fileIn(), [ok(1), ok(2)], { now: 1_000 });
    await feed.refresh(false);
    await feed.refresh(true);
    expect(calls()).toBe(2);
    expect(await feed.read()).toMatchObject({ snapshot: { items: [{ n: 2 }] } });
  });

  it('sends one request at a time per window', async () => {
    let calls = 0;
    let answer: (v: Fetched<Item>) => void = () => undefined;
    const pending = new Promise<Fetched<Item>>((resolve) => {
      answer = resolve;
    });
    const feed = new Feed<Item>(await fileIn(), isItem, {
      fetch: () => {
        calls += 1;
        return pending;
      },
      now: () => 1_000,
    });
    const first = feed.refresh(false);
    const second = feed.refresh(false);
    answer(ok(1));
    await Promise.all([first, second]);
    expect(calls).toBe(1);
  });

  it('reads a fetch that throws as unavailable, never as an exception', async () => {
    const { feed } = scripted(await fileIn(), [new Error('boom')], { now: 1_000 });
    await expect(feed.refresh(false)).resolves.toBeUndefined();
    expect(await feed.read()).toEqual({ kind: 'unavailable' });
  });

  it('ignores a cache it does not recognise, and drops the items that do not read', async () => {
    const file = await fileIn();
    const { feed } = scripted(file, [{ kind: 'unavailable' }], { now: 1_000 });
    await writeFile(file, JSON.stringify({ version: 2, at: 5, items: [{ n: 1 }] }), 'utf8');
    expect(await feed.read()).toEqual({ kind: 'loading' });
    await writeFile(
      file,
      JSON.stringify({ version: 1, at: 5, truncated: true, items: [{ n: 1 }, { x: '?' }, null] }),
      'utf8',
    );
    expect(await feed.read()).toEqual({ kind: 'ready', snapshot: { at: 5, items: [{ n: 1 }], truncated: true } });
    await writeFile(file, 'pas du JSON', 'utf8');
    expect(await feed.read()).toEqual({ kind: 'loading' });
  });

  it('still shows what it read when the file cannot be written', async () => {
    const file = join(await mkdtemp(join(tmpdir(), 'koh-feed-')), 'missing-dir', 'feed.json');
    const { feed } = scripted(file, [ok(3)], { now: 1_000 });
    await feed.refresh(false);
    expect(await feed.read()).toMatchObject({ kind: 'ready', snapshot: { items: [{ n: 3 }] } });
  });

  it('says when the server held part of the list back', async () => {
    const { feed } = scripted(await fileIn(), [{ kind: 'ok', items: [{ n: 1 }], truncated: true }], { now: 1_000 });
    await feed.refresh(false);
    expect(await feed.read()).toMatchObject({ snapshot: { truncated: true } });
  });
});
