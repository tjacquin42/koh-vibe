import { describe, expect, it } from 'vitest';
import type { FileState, Item } from '../src/host/activity/index';
import { agentIdOf, buildSheet, displayPath, parseAgentMeta, readAgentMetas, SHEET_TOOLS } from '../src/host/activity/sheet';
import { parseLine } from '../src/host/activity/transcript';

const HOME = '/Users/me';
const CWD = '/Users/me/DEV/shop';
const T = 1_800_000_000_000;

function state(path: string, sessionId: string, subagent: boolean, items: Item[], tokens = 0): FileState {
  const usage = new Map();
  if (tokens > 0) usage.set(`m-${path}`, { at: T, usage: { input: tokens, output: 0, cacheWrite: 0, cacheRead: 0 } });
  return { path, sessionId, subagent, offset: 0, size: 0, mtimeMs: 0, cwd: CWD, usage, items };
}

const own = state(`/p/s1.jsonl`, 's1', false, [
  { kind: 'prompt', at: T, text: 'Fix the date test' },
  { kind: 'tool', at: T + 1, tool: 'Edit', target: 'dates.ts', path: `${CWD}/src/dates.ts` },
  { kind: 'tool', at: T + 2, tool: 'Bash', target: 'pnpm test' },
  { kind: 'prompt', at: T + 3, text: 'Now the docs' },
  { kind: 'tool', at: T + 4, tool: 'Edit', target: 'dates.ts', path: `${CWD}/src/dates.ts` },
], 100);
const sub = state(`/p/s1/subagents/agent-abc.jsonl`, 's1', true, [
  { kind: 'prompt', at: T + 5, text: 'Review the change carefully' },
  { kind: 'tool', at: T + 6, tool: 'Write', target: 'notes.md', path: `${HOME}/notes.md` },
], 40);
const other = state(`/p/s2.jsonl`, 's2', false, [{ kind: 'tool', at: T, tool: 'Read', target: 'x' }]);

describe('session sheet', () => {
  it('gathers one conversation and its subagents, and nothing else', () => {
    const sheet = buildSheet([own, sub, other], 's1', T - 1, new Map(), HOME);
    expect(sheet?.toolCount).toBe(4);
    expect(sheet?.tools.map((t) => t.tool)).toEqual(['Write', 'Edit', 'Bash', 'Edit']);
    expect(sheet?.tools[0]?.agent).toBe('abc');
    expect(sheet?.tokens.input).toBe(100);
    expect(sheet?.subagentTokens.input).toBe(40);
    expect(sheet?.lastPrompt).toEqual({ at: T + 3, text: 'Now the docs' });
  });

  it('lists the files written, relative to the conversation or under ~, never the full home', () => {
    const sheet = buildSheet([own, sub], 's1', T - 1, new Map(), HOME);
    expect(sheet?.files).toEqual([
      { path: '~/notes.md', writes: 1, lastAt: T + 6 },
      { path: 'src/dates.ts', writes: 2, lastAt: T + 4 },
    ]);
    expect(JSON.stringify(sheet)).not.toContain(HOME);
  });

  it('names a subagent by its meta, else by its prompt', () => {
    const named = buildSheet([own, sub], 's1', T - 1, new Map([['abc', { description: 'Review task 3', agentType: 'Explore', model: 'sonnet', finished: true }]]), HOME);
    expect(named?.agents).toEqual([
      { id: 'abc', label: 'Review task 3', type: 'Explore', model: 'sonnet', finished: true, tokens: { input: 40, output: 0, cacheWrite: 0, cacheRead: 0 }, tools: 1, firstAt: T, lastAt: T + 6 },
    ]);
    expect(buildSheet([own, sub], 's1', T - 1, new Map(), HOME)?.agents[0]?.label).toBe('Review the change carefully');
  });

  it('caps the calls listed but keeps the count', () => {
    const many: Item[] = Array.from({ length: SHEET_TOOLS + 20 }, (_, i) => ({ kind: 'tool', at: T + i, tool: 'Read' }));
    const sheet = buildSheet([state('/p/s3.jsonl', 's3', false, many)], 's3', T - 1, new Map(), HOME);
    expect(sheet?.tools).toHaveLength(SHEET_TOOLS);
    expect(sheet?.toolCount).toBe(SHEET_TOOLS + 20);
  });

  it('has no sheet for a conversation with nothing in the window', () => {
    expect(buildSheet([own], 'nope', T - 1, new Map(), HOME)).toBeUndefined();
  });
});

describe('sheet helpers', () => {
  it('reads paths and metas', async () => {
    expect(displayPath('/elsewhere/x', CWD, HOME)).toBe('/elsewhere/x');
    expect(agentIdOf('/p/s1/subagents/agent-a0394638.jsonl')).toBe('a0394638');
    expect(parseAgentMeta('{"description":" Do it ","agentType":"general-purpose","finished":false}')).toEqual({ description: 'Do it', agentType: 'general-purpose', finished: false });
    expect(parseAgentMeta('nope')).toEqual({});
    const metas = await readAgentMetas([own, sub], async (p) => {
      if (p.endsWith('agent-abc.meta.json')) return '{"description":"Read it"}';
      throw new Error('ENOENT');
    });
    expect([...metas]).toEqual([['abc', { description: 'Read it' }]]);
  });

  it('keeps a file tool its full path, on the host side', () => {
    const line = JSON.stringify({
      type: 'assistant',
      timestamp: '2027-01-15T08:00:00.000Z',
      message: { id: 'm', content: [{ type: 'tool_use', name: 'Edit', input: { file_path: '/w/src/a.ts' } }] },
    });
    expect(parseLine(line)).toContainEqual({ kind: 'tool', at: Date.parse('2027-01-15T08:00:00.000Z'), tool: 'Edit', target: 'a.ts', path: '/w/src/a.ts' });
  });
});
