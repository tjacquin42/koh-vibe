import { describe, expect, it } from 'vitest';
import { locateProcess, scanProcesses, type ProcessDeps } from '../src/host/processes';
import { tableOf, type ProcRow } from '../../src/process/scan';
import type { LiveSession } from '../../src/claude/registry';

const row = (pid: number, ppid: number, command: string): ProcRow => ({ pid, ppid, elapsed: 30, rss: 1024, command });

const rows = [
  row(10, 1, 'claude'),
  row(11, 10, 'node mcp.js'),
  row(12, 10, '/bin/zsh -c source /home/me/.claude/shell-snapshots/x.sh && pnpm dev'),
  row(13, 12, 'vite'),
  row(20, 1, 'claude'),
  row(30, 1, 'node server.js'),
];

function deps(): ProcessDeps {
  const live = new Map<string, LiveSession>([
    ['a', { pid: 10, sessionId: 'a', cwd: '/w/a', entrypoint: 'cli' }],
    ['b', { pid: 20, sessionId: 'b', cwd: '/w/b', entrypoint: 'cli' }],
  ]);
  return { table: async () => tableOf(rows), live: async () => live };
}

describe('scanProcesses', () => {
  it('lists each live conversation’s processes by kind, and leaves out the ones running nothing', async () => {
    const v = await scanProcesses(deps(), 5);
    expect(v.at).toBe(5);
    expect(Object.keys(v.bySession)).toEqual(['a']);
    expect(v.bySession['a']?.map((p) => [p.pid, p.kind, p.depth])).toEqual([
      [11, 'mcp', 0],
      [12, 'shell', 0],
      [13, 'work', 1],
    ]);
  });
});

describe('locateProcess', () => {
  it('finds a listed process again, with the list it sits in', async () => {
    const found = await locateProcess(deps(), 13);
    expect(found?.proc.pid).toBe(13);
    expect(found?.among.map((p) => p.pid)).toEqual([11, 12, 13]);
  });

  it('finds nothing for a pid no conversation runs — a server left behind, a conversation itself', async () => {
    expect(await locateProcess(deps(), 30)).toBeUndefined();
    expect(await locateProcess(deps(), 10)).toBeUndefined();
    expect(await locateProcess(deps(), 999)).toBeUndefined();
  });
});
