import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { rankSpend, Spend, takeLines, weightOf, type FileSpend } from '../src/host/spend';

const NOW = Date.UTC(2026, 10, 15, 12, 0);
const HOUR = 3_600_000;
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

const answer = (id: string, ago: number, usage: Record<string, number>, model = 'claude-opus-5-5'): string =>
  JSON.stringify({ type: 'assistant', timestamp: new Date(NOW - ago).toISOString(), message: { id, model, usage } });

const file = (sessionId: string): FileSpend => ({ sessionId, offset: 0, seen: new Set(), points: [] });

describe('spend', () => {
  it('weighs tokens by what they cost, and by the model', () => {
    expect(weightOf('claude-haiku-5-5', { input_tokens: 100 })).toBe(100);
    expect(weightOf('claude-haiku-5-5', { output_tokens: 100 })).toBe(500);
    expect(weightOf('claude-haiku-5-5', { cache_read_input_tokens: 100 })).toBeCloseTo(10);
    expect(weightOf('claude-haiku-5-5', { cache_creation_input_tokens: 100 })).toBe(125);
    expect(weightOf('claude-sonnet-5-5', { input_tokens: 100 })).toBe(300);
    expect(weightOf('claude-opus-5-5', { input_tokens: 100 })).toBe(500);
  });

  it('counts an answer once though Claude Code writes a line per block of it', () => {
    const f = file(A);
    const line = answer('msg_1', HOUR, { input_tokens: 10 }, 'claude-haiku-5-5');
    takeLines(f, [line, line, 'not json', JSON.stringify({ type: 'ai-title', aiTitle: 'Le titre' })], NOW - 7 * 24 * HOUR);
    expect(f.points).toEqual([{ at: NOW - HOUR, weight: 10 }]);
    expect(f.title).toBe('Le titre');
  });

  it('ranks each window by share, and leaves out what is older than it', () => {
    const a = file(A);
    const b = file(B);
    takeLines(a, [answer('a1', 2 * HOUR, { input_tokens: 300 }), answer('a2', 3 * 24 * HOUR, { input_tokens: 10_000 })], NOW - 7 * 24 * HOUR);
    takeLines(b, [answer('b1', HOUR, { input_tokens: 100 })], NOW - 7 * 24 * HOUR);
    const ranked = rankSpend([a, b], NOW);
    expect(ranked.windows['5h'].map((e) => [e.sessionId, Math.round(e.share * 100)])).toEqual([
      [A, 75],
      [B, 25],
    ]);
    expect(ranked.windows['24h'].map((e) => e.sessionId)).toEqual([A, B]);
    expect(ranked.windows['7d'][0]?.sessionId).toBe(A);
    expect(ranked.windows['7d'][0]?.share).toBeGreaterThan(0.95);
  });
});

describe('Spend, on disk', () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'kv-spend-'));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('counts a conversation’s subagents towards it, and reads only what was added since', async () => {
    const project = join(root, '-Users-dev-projet');
    await mkdir(join(project, A, 'subagents'), { recursive: true });
    await writeFile(join(project, `${A}.jsonl`), `${answer('m1', HOUR, { input_tokens: 100 })}\n`);
    await writeFile(join(project, A, 'subagents', 'agent-x.jsonl'), `${answer('m2', HOUR, { input_tokens: 100 })}\n`);
    await writeFile(join(project, `${B}.jsonl`), `${answer('m3', HOUR, { input_tokens: 100 })}\n${answer('m4', HOUR, { input_tokens: 1 })}`);
    const spend = new Spend(root);
    const first = await spend.refresh(NOW);
    // B's last line has no line break yet: still being written, not counted.
    expect(first.windows['5h'].map((e) => [e.sessionId, Math.round(e.share * 100)])).toEqual([
      [A, 67],
      [B, 33],
    ]);
    await writeFile(join(project, `${B}.jsonl`), `${answer('m3', HOUR, { input_tokens: 100 })}\n${answer('m4', HOUR, { input_tokens: 300 })}\n`);
    const second = await spend.refresh(NOW);
    expect(second.windows['5h'][0]?.sessionId).toBe(B);
  });
});
