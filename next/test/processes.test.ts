import { describe, expect, it } from 'vitest';
import { scanProcesses, type ProcessDeps } from '../src/host/processes';
import { tableOf, type ProcRow } from '../../src/process/scan';
import { classifyDetached } from '../../src/process/classify';
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

function deps(orphanCalls: { n: number }): ProcessDeps {
  const live = new Map<string, LiveSession>([
    ['a', { pid: 10, sessionId: 'a', cwd: '/w/a', entrypoint: 'cli' }],
    ['b', { pid: 20, sessionId: 'b', cwd: '/w/b', entrypoint: 'cli' }],
  ]);
  return {
    table: async () => tableOf(rows),
    live: async () => live,
    orphans: async (table) => {
      orphanCalls.n++;
      const tree = classifyDetached([{ ...row(30, 1, 'node server.js'), depth: 0 }]);
      const root = tree[0];
      if (root === undefined) return [];
      void table;
      return [
        { root, tree, cwd: '/w/gone' },
        { root, tree, cwd: '/w/b', sessionId: 'b' },
      ];
    },
  };
}

describe('scanProcesses', () => {
  it('lists each live conversation’s processes by kind, and leaves out the ones running nothing', async () => {
    const calls = { n: 0 };
    const v = await scanProcesses(deps(calls), ['/w'], false, 5);
    expect(v.at).toBe(5);
    expect(Object.keys(v.bySession)).toEqual(['a']);
    expect(v.bySession['a']?.map((p) => [p.pid, p.kind, p.depth])).toEqual([
      [11, 'mcp', 0],
      [12, 'shell', 0],
      [13, 'work', 1],
    ]);
    expect(v.orphans).toBeUndefined();
    expect(calls.n).toBe(0);
  });

  it('puts a detached server back under its live conversation, and lists the rest as orphans', async () => {
    const calls = { n: 0 };
    const v = await scanProcesses(deps(calls), ['/w'], true, 5);
    expect(calls.n).toBe(1);
    expect(v.bySession['b']?.map((p) => p.pid)).toEqual([30]);
    expect(v.orphans?.map((o) => o.cwd)).toEqual(['/w/gone']);
  });
});
