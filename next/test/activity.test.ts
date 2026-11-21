import { appendFile, mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ActivityIndex, nodeFs, sessionOfPath, startOffset, type FsDeps } from '../src/host/activity/index';
import { firstLine, lineTime, parseLine, toolTarget } from '../src/host/activity/transcript';
import { busyStretches, toActivityView } from '../src/host/activity/view';

const touch = (path: string, at: number): Promise<void> => utimes(path, new Date(at), new Date(at));
const T0 = Date.parse('2026-11-14T10:00:00.000Z');
const iso = (ms: number): string => new Date(ms).toISOString();

const assistant = (at: number, id: string, content: unknown[], usage = { input_tokens: 2, output_tokens: 10, cache_creation_input_tokens: 100, cache_read_input_tokens: 1000 }): string =>
  JSON.stringify({ type: 'assistant', timestamp: iso(at), cwd: '/work/shop', message: { id, model: 'claude-x', content, usage } });
const user = (at: number, content: unknown, extra: Record<string, unknown> = {}): string =>
  JSON.stringify({ type: 'user', timestamp: iso(at), cwd: '/work/shop', message: { role: 'user', content }, ...extra });

describe('parseLine', () => {
  it('reads usage once per line, with the cache, and the tool calls and text of an assistant turn', () => {
    const e = parseLine(assistant(T0, 'm1', [{ type: 'text', text: '\n Done.\nmore' }, { type: 'tool_use', name: 'Edit', input: { file_path: '/home/me/src/a.ts' } }]));
    expect(e).toEqual([
      { kind: 'cwd', cwd: '/work/shop' },
      { kind: 'usage', at: T0, messageId: 'm1', model: 'claude-x', usage: { input: 2, output: 10, cacheWrite: 100, cacheRead: 1000 } },
      { kind: 'text', at: T0, text: 'Done.' },
      { kind: 'tool', at: T0, tool: 'Edit', target: 'a.ts', path: '/home/me/src/a.ts' },
    ]);
  });

  it('keeps typed prompts and drops tool results, meta records and injected tags', () => {
    expect(parseLine(user(T0, 'Fix the build please'))).toContainEqual({ kind: 'prompt', at: T0, text: 'Fix the build please' });
    expect(parseLine(user(T0, [{ type: 'tool_result', content: 'x' }])).filter((e) => e.kind === 'prompt')).toEqual([]);
    expect(parseLine(user(T0, 'hidden', { isMeta: true })).filter((e) => e.kind === 'prompt')).toEqual([]);
    expect(parseLine(user(T0, '<task-notification>x</task-notification>')).filter((e) => e.kind === 'prompt')).toEqual([]);
  });

  it('reads titles, and skips lines it has no use for without parsing them', () => {
    expect(parseLine(JSON.stringify({ type: 'custom-title', customTitle: 'Mine' }))).toEqual([{ kind: 'title', title: 'Mine', source: 'custom' }]);
    expect(parseLine(JSON.stringify({ type: 'ai-title', aiTitle: 'Generated' }))).toEqual([{ kind: 'title', title: 'Generated', source: 'ai' }]);
    expect(parseLine('{"type":"api-request-blob", broken')).toEqual([]);
    expect(parseLine('not json "type":"assistant"')).toEqual([]);
  });

  it('names a tool call by a base name or a short description', () => {
    expect(toolTarget({ command: 'pnpm test\n--watch' })).toBe('pnpm test');
    expect(toolTarget({ description: 'Run tests', command: 'x' })).toBe('Run tests');
    expect(toolTarget({ notebook_path: '/a/b/n.ipynb' })).toBe('n.ipynb');
    expect(toolTarget(undefined)).toBeUndefined();
    expect(firstLine('  ')).toBeUndefined();
    expect(lineTime(user(T0, 'x'))).toBe(T0);
  });
});

describe('sessionOfPath', () => {
  it('ties a subagent transcript to its parent conversation', () => {
    expect(sessionOfPath('/p/proj/abc.jsonl')).toEqual({ sessionId: 'abc', subagent: false });
    expect(sessionOfPath('/p/proj/abc/subagents/agent-1.jsonl')).toEqual({ sessionId: 'abc', subagent: true });
  });
});

describe('startOffset', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'kvn-act-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  /** Reads in tiny chunks through a wrapper, so lines straddle chunk boundaries. */
  it('finds the first line inside the window, whatever the chunk boundaries', async () => {
    const lines = Array.from({ length: 40 }, (_, i) => user(T0 + i * 60_000, `prompt ${i} ${'x'.repeat(i * 7)}`));
    lines.splice(25, 0, JSON.stringify({ type: 'ai-title', aiTitle: 'no stamp' }));
    const text = `${lines.join('\n')}\n`;
    const file = join(dir, 'a.jsonl');
    await writeFile(file, text);
    const size = Buffer.byteLength(text);
    const since = T0 + 30 * 60_000;
    const expected = text.indexOf(user(T0 + 30 * 60_000, `prompt 30 ${'x'.repeat(210)}`));
    expect(await startOffset(nodeFs, file, size, since)).toBe(expected);
    for (const chunk of [7, 64, 333]) expect(await startOffset(nodeFs, file, size, since, chunk)).toBe(expected);
    expect(await startOffset(nodeFs, file, size, T0 - 1)).toBe(0);
    expect(await startOffset(nodeFs, file, size, T0 + 999 * 60_000)).toBe(size);
  });
});

describe('ActivityIndex', () => {
  let root: string;
  let proj: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'kvn-proj-'));
    proj = join(root, '-work-shop');
    await mkdir(join(proj, 's1', 'subagents'), { recursive: true });
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('reads only the window, counts each message once, follows appends, folds in subagents', async () => {
    const now = T0 + 30 * 3_600_000;
    const old = assistant(T0, 'old', [{ type: 'text', text: 'yesterday' }]);
    const m1 = assistant(now - 3_600_000, 'm1', [{ type: 'text', text: 'Looking' }]);
    const m1again = assistant(now - 3_600_000, 'm1', [{ type: 'tool_use', name: 'Read', input: { file_path: '/x/y.ts' } }]);
    await writeFile(join(proj, 's1.jsonl'), [JSON.stringify({ type: 'custom-title', customTitle: 'Shop work' }), old, user(now - 3_700_000, 'Go'), m1, m1again, ''].join('\n'));
    await writeFile(join(proj, 's1', 'subagents', 'agent-a.jsonl'), `${assistant(now - 1_800_000, 'sub1', [{ type: 'tool_use', name: 'Grep', input: { pattern: 'TODO' } }])}\n`);
    await touch(join(proj, 's1.jsonl'), now - 60_000);
    await touch(join(proj, 's1', 'subagents', 'agent-a.jsonl'), now - 60_000);
    // A conversation untouched for two days: never opened.
    await writeFile(join(proj, 'stale.jsonl'), `${assistant(T0, 'z', [])}\n`);
    await utimes(join(proj, 'stale.jsonl'), new Date(T0 - 86_400_000), new Date(T0 - 86_400_000));

    const index = new ActivityIndex(root);
    await index.refresh(now);
    let view = toActivityView(index.states, now, now - 86_400_000, new Map());
    expect(view.sessions).toHaveLength(1);
    const s = view.sessions[0];
    expect(s?.title).toBe('Shop work');
    expect(s?.project).toBe('shop');
    expect(s?.tokens).toEqual({ input: 2, output: 10, cacheWrite: 100, cacheRead: 1000 });
    expect(s?.subagentTokens.cacheRead).toBe(1000);
    expect(s?.subagents).toBe(1);
    expect(s?.tail.map((i) => i.text)).toEqual(['Go', 'Looking', 'y.ts']);
    expect(view.feed[0]).toMatchObject({ kind: 'tool', tool: 'Grep', subagent: true });

    await appendFile(join(proj, 's1.jsonl'), `${assistant(now - 60_000, 'm2', [{ type: 'text', text: 'Fixed' }])}\n{"type":"user","half`);
    await touch(join(proj, 's1.jsonl'), now - 30_000);
    await index.refresh(now);
    view = toActivityView(index.states, now, now - 86_400_000, new Map([['s1', { title: 'From V1', project: 'shop-front' }]]));
    expect(view.sessions[0]?.tokens.input).toBe(4);
    expect(view.sessions[0]?.tail.at(-1)?.text).toBe('Fixed');
    expect(view.sessions[0]?.title).toBe('From V1');
    expect(view.sessions[0]?.project).toBe('shop-front');
  });

  it('forgets what slid out of the window', async () => {
    const now = T0 + 3_600_000;
    await writeFile(join(proj, 's1.jsonl'), `${assistant(T0 + 600_000, 'm', [{ type: 'text', text: 'hi' }])}\n`);
    await touch(join(proj, 's1.jsonl'), T0 + 600_000);
    const index = new ActivityIndex(root, nodeFs, 3_600_000);
    await index.refresh(now);
    expect(toActivityView(index.states, now, now - 3_600_000, new Map()).sessions).toHaveLength(1);
    await index.refresh(now + 3_000_000);
    expect(toActivityView(index.states, now + 3_000_000, now, new Map()).sessions).toHaveLength(0);
  });

  it('does not throw on a directory that does not exist', async () => {
    const fs: FsDeps = nodeFs;
    const index = new ActivityIndex(join(root, 'missing'), fs);
    await index.refresh(T0);
    expect(index.states).toEqual([]);
  });
});

describe('busyStretches', () => {
  it('merges stamps closer than the idle gap', () => {
    expect(busyStretches([0, 60_000, 120_000, 1_000_000])).toEqual([
      [0, 180_000],
      [1_000_000, 1_060_000],
    ]);
  });
});
