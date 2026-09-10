import { describe, expect, it } from 'vitest';
import { SessionsTree, nodeId, processOfNode } from '../src/ui/tree';
import type { TreeNode } from '../src/ui/tree';
import type { Session } from '../src/events/types';
import { classify, type SessionProcess } from '../src/process/classify';
import { descendantsOf, parsePs } from '../src/process/scan';
import { TreeItemCollapsibleState } from './stubs/vscode';

const EXT = '/ext';
const SNAPSHOT = '/Users/jack/.claude/shell-snapshots/snap.sh';

const session = (id: string): Session => ({
  id,
  cwd: '/Users/dev/projet',
  project: 'projet',
  origin: 'vscode',
  status: 'idle',
  toolCount: 0,
  lastEventAt: 0,
});

const noop = async (): Promise<void> => undefined;
const newTree = (): SessionsTree => new SessionsTree(async () => true, noop, noop, EXT);

/** `elapsed` in seconds, so a test can age a process without rebuilding one. */
const tree = (elapsed: string): SessionProcess[] =>
  classify(
    descendantsOf(
      parsePs(
        [
          `100   1  ${elapsed} 1000 /path/to/claude`,
          `200 100  ${elapsed} 1000 /opt/homebrew/bin/uv tool uvx alpaca-mcp-server`,
          `300 100  ${elapsed} 1000 /bin/zsh -c source ${SNAPSHOT} && eval 'pnpm dev' < /dev/null`,
          `400 300  ${elapsed} 1000 node vite`,
        ].join('\n'),
      ),
      100,
    ),
  );

const sessionNode = async (t: SessionsTree, id: string): Promise<TreeNode> => {
  const group = (await t.getChildren()).find((n) => n.kind === 'group')!;
  return (await t.getChildren(group)).find((n) => n.kind === 'session' && n.session.id === id)!;
};

describe('SessionsTree — the processes of a session', () => {
  it('leaves a session that started nothing unfoldable', async () => {
    const t = newTree();
    t.setSessions(new Map([['s1', session('s1')]]));

    const item = t.getTreeItem(await sessionNode(t, 's1'));
    expect(item.collapsibleState).toBe(TreeItemCollapsibleState.None);
  });

  it('unfolds a session into what it started itself, not into the whole tree flattened', async () => {
    const t = newTree();
    t.setSessions(new Map([['s1', session('s1')]]));
    t.setProcesses(new Map([['s1', tree('10')]]));

    const node = await sessionNode(t, 's1');
    expect(t.getTreeItem(node).collapsibleState).toBe(TreeItemCollapsibleState.Collapsed);
    const rows = await t.getChildren(node);
    expect(rows.map((r) => t.getTreeItem(r).label)).toEqual(['uv tool uvx alpaca-mcp-server', 'pnpm dev']);
  });

  it('unfolds a process into what that process started', async () => {
    const t = newTree();
    t.setSessions(new Map([['s1', session('s1')]]));
    t.setProcesses(new Map([['s1', tree('10')]]));

    const shell = (await t.getChildren(await sessionNode(t, 's1'))).find(
      (n) => n.kind === 'process' && n.proc.pid === 300,
    )!;
    expect(t.getTreeItem(shell).collapsibleState).toBe(TreeItemCollapsibleState.Collapsed);
    const rows = await t.getChildren(shell);
    expect(rows.map((r) => t.getTreeItem(r).label)).toEqual(['node vite']);
  });

  it('counts the work on the session row, and leaves the MCP servers out of the count', async () => {
    const t = newTree();
    t.setSessions(new Map([['s1', session('s1')]]));
    t.setProcesses(new Map([['s1', tree('10')]]));

    expect(String(t.getTreeItem(await sessionNode(t, 's1')).description)).toContain('2 running');
  });

  it('gives a process row no command, so a click on it does nothing', async () => {
    const t = newTree();
    t.setSessions(new Map([['s1', session('s1')]]));
    t.setProcesses(new Map([['s1', tree('10')]]));

    const rows = await t.getChildren(await sessionNode(t, 's1'));
    expect(rows.map((r) => t.getTreeItem(r).command)).toEqual([undefined, undefined]);
  });

  it('marks an MCP row apart, so the confirmation can warn about it', async () => {
    const t = newTree();
    t.setSessions(new Map([['s1', session('s1')]]));
    t.setProcesses(new Map([['s1', tree('10')]]));

    const rows = await t.getChildren(await sessionNode(t, 's1'));
    expect(rows.map((r) => t.getTreeItem(r).contextValue)).toEqual(['processMcp', 'process']);
  });

  it('never gives two sessions running the same pid the same row identity', () => {
    const [proc] = tree('10');
    const a = nodeId({ kind: 'process', sessionId: 's1', proc: proc! });
    const b = nodeId({ kind: 'process', sessionId: 's2', proc: proc! });
    expect(a).not.toBe(b);
  });
});

describe('SessionsTree — redrawing on process changes', () => {
  const redrawsOf = (t: SessionsTree): { count: () => number } => {
    let count = 0;
    t.onDidChangeTreeData(() => {
      count += 1;
    });
    return { count: () => count };
  };

  it('does not redraw the tree just because the processes aged a few seconds', () => {
    // The regression this guards: `elapsed` counts seconds, so putting it in
    // the render signature would rebuild every row twice a second and snatch
    // the tooltip out from under the pointer — the bug `nodeId` and the
    // coarse ages were introduced to fix.
    const t = newTree();
    t.setSessions(new Map([['s1', session('s1')]]));
    t.setProcesses(new Map([['s1', tree('10')]]));
    const redraws = redrawsOf(t);

    t.setProcesses(new Map([['s1', tree('12')]]));
    t.setProcesses(new Map([['s1', tree('30')]]));

    expect(redraws.count()).toBe(0);
  });

  it('redraws when a process actually appears', () => {
    const t = newTree();
    t.setSessions(new Map([['s1', session('s1')]]));
    t.setProcesses(new Map([['s1', tree('10')]]));
    const redraws = redrawsOf(t);

    t.setProcesses(new Map([['s1', tree('10').filter((p) => p.pid !== 400)]]));

    expect(redraws.count()).toBe(1);
  });

  it('redraws when the age crosses the minute the label shows', () => {
    const t = newTree();
    t.setSessions(new Map([['s1', session('s1')]]));
    t.setProcesses(new Map([['s1', tree('10')]]));
    const redraws = redrawsOf(t);

    t.setProcesses(new Map([['s1', tree('02:30')]]));

    expect(redraws.count()).toBe(1);
  });
});

describe('processOfNode', () => {
  it('reads a process row', () => {
    const [proc] = tree('10');
    expect(processOfNode({ kind: 'process', sessionId: 's1', proc })).toEqual({ sessionId: 's1', pid: 200 });
  });

  it('refuses anything that is not one — the argument arrives as unknown, and the pid ends up in a kill', () => {
    const [proc] = tree('10');
    expect(processOfNode(undefined)).toBeUndefined();
    expect(processOfNode({ kind: 'session', session: { id: 's1' } })).toBeUndefined();
    expect(processOfNode({ kind: 'process', sessionId: 's1' })).toBeUndefined();
    expect(processOfNode({ kind: 'process', sessionId: 42, proc })).toBeUndefined();
    expect(processOfNode({ kind: 'process', sessionId: 's1', proc: { pid: '200' } })).toBeUndefined();
    expect(processOfNode({ kind: 'process', sessionId: 's1', proc: { pid: -1 } })).toBeUndefined();
    expect(processOfNode({ kind: 'process', sessionId: 's1', proc: { pid: 1.5 } })).toBeUndefined();
  });
});

describe('SessionsTree — a hidden view costs nothing', () => {
  it('shows no process at all once the scan stops feeding it', async () => {
    // What the wiring does when the panel is collapsed: it feeds an empty map
    // rather than a stale one, so the view never shows a process table from
    // ten minutes ago as if it were live.
    const t = newTree();
    t.setSessions(new Map([['s1', session('s1')]]));
    t.setProcesses(new Map([['s1', tree('10')]]));
    t.setProcesses(new Map());

    const node = await sessionNode(t, 's1');
    expect(t.getTreeItem(node).collapsibleState).toBe(TreeItemCollapsibleState.None);
    expect(await t.getChildren(node)).toEqual([]);
  });
});
