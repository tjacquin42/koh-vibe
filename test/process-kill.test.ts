import { describe, expect, it } from 'vitest';
import { killAll, killPlan, killTargets } from '../src/process/kill';
import { classify } from '../src/process/classify';
import { descendantsOf, parsePs } from '../src/process/scan';

const SNAPSHOT = '/Users/jack/.claude/shell-snapshots/snap.sh';

const TREE = classify(
  descendantsOf(
    parsePs(
      [
        '100   1  10 1000 /path/to/claude',
        '200 100  10 1000 /opt/homebrew/bin/uv tool uvx alpaca-mcp-server',
        `300 100  10 1000 /bin/zsh -c source ${SNAPSHOT} && eval 'pnpm dev' < /dev/null`,
        '400 300  10 1000 npm run dev',
        '500 400  10 1000 node vite',
      ].join('\n'),
    ),
    100,
  ),
);

const at = (pid: number) => TREE.find((p) => p.pid === pid)!;

describe('killTargets', () => {
  it('takes the process and everything under it, deepest first', () => {
    // Deepest first because a parent killed on its own leaves its children
    // reparented to pid 1 — off every session's subtree, and so out of this
    // view for good. Killing a shell without its `vite` is exactly how an
    // orphan dev server is made.
    expect(killTargets(TREE, 300).map((p) => p.pid)).toEqual([500, 400, 300]);
  });

  it('is just the process when it started nothing', () => {
    expect(killTargets(TREE, 500).map((p) => p.pid)).toEqual([500]);
  });

  it('has nothing to kill for a pid it does not know', () => {
    expect(killTargets(TREE, 999)).toEqual([]);
  });
});

describe('killPlan', () => {
  it('names the command, so the confirmation is about something recognisable', () => {
    expect(killPlan(TREE, at(300)).message).toContain('pnpm dev');
  });

  it('announces the children that go with it', () => {
    expect(killPlan(TREE, at(300)).message).toContain('2');
  });

  it('says nothing about children when there are none', () => {
    expect(killPlan(TREE, at(500)).detail).toBeUndefined();
  });

  it('warns that an MCP server is not the users to kill without cost', () => {
    const plan = killPlan(TREE, at(200));
    expect(plan.detail).toBeDefined();
    expect(plan.destructive).toBe(true);
  });

  it('does not dramatise an ordinary process', () => {
    expect(killPlan(TREE, at(500)).destructive).toBe(false);
  });
});

describe('killAll', () => {
  it('signals every target, in the order it was given', () => {
    const sent: number[] = [];
    const killed = killAll(killTargets(TREE, 300), (pid) => void sent.push(pid));
    expect(sent).toEqual([500, 400, 300]);
    expect(killed).toBe(3);
  });

  it('carries on past a process that is already gone', () => {
    // The ordinary race: the table is a snapshot, and the click comes later.
    const sent: number[] = [];
    const killed = killAll(killTargets(TREE, 300), (pid) => {
      if (pid === 400) throw new Error('ESRCH');
      sent.push(pid);
    });
    expect(sent).toEqual([500, 300]);
    expect(killed).toBe(2);
  });
});
