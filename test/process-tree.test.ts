import { describe, expect, it } from 'vitest';
import { ProcessesTree, orphanOfNode, processNodeId } from '../src/ui/process-tree';
import type { Session } from '../src/events/types';
import { classify } from '../src/process/classify';
import { descendantsOf, parsePs, tableOf } from '../src/process/scan';
import { subtreeOf, type Orphan } from '../src/process/orphans';
import { TreeItemCollapsibleState } from './stubs/vscode';

const SNAPSHOT = '/Users/jack/.claude/shell-snapshots/snap.sh';

const session = (id: string, project: string): Session => ({
  id,
  cwd: `/Users/dev/${project}`,
  project,
  origin: 'vscode',
  status: 'idle',
  toolCount: 0,
  lastEventAt: 0,
});

const procs = (rootPid: number) =>
  classify(
    descendantsOf(
      tableOf(parsePs(
        [
          `${rootPid}   1  10 1000 /path/to/claude`,
          `${rootPid + 1} ${rootPid}  02:00 8000 /opt/homebrew/bin/uv tool uvx alpaca-mcp-server`,
          `${rootPid + 2} ${rootPid + 1}  02:00 4000 /Users/jack/.cache/uv/bin/python -m alpaca_mcp`,
          `${rootPid + 3} ${rootPid}  01:00 2000 /Applications/Spline.app/Contents/MacOS/Spline spline-mcp.cjs`,
          `${rootPid + 4} ${rootPid}  00:30 1000 /bin/zsh -c source ${SNAPSHOT} && eval 'pnpm dev' < /dev/null`,
        ].join('\n'),
      )),
      rootPid,
    ),
  );

/**
 * A ghost in the shape the system actually leaves: an adopted shell, with the
 * server that holds the port under it.
 */
const orphan = (pid: number, project: string): Orphan => {
  const tree = subtreeOf(
    tableOf(parsePs(
      [
        `${pid}   1  01:00 1000 /bin/zsh -c node vite; true`,
        `${pid + 1} ${pid}  01:00 210000 /usr/local/bin/node /Users/dev/${project}/node_modules/.bin/vite`,
      ].join('\n'),
    )),
    pid,
  );
  return { root: tree[0]!, tree, cwd: `/Users/dev/${project}` };
};

const newTree = (): ProcessesTree => new ProcessesTree();

const rowsOf = async (tree: ProcessesTree, node?: never): Promise<string[]> => {
  const children = await tree.getChildren(node);
  return children.map((c) => String(tree.getTreeItem(c).label));
};

describe('ProcessesTree — sections', () => {
  it('says so plainly while nothing has been scanned', async () => {
    expect(await rowsOf(newTree())).toEqual(['Nothing is running']);
  });

  it('shows only the sections that have something in them', async () => {
    const tree = newTree();
    tree.setProcesses(new Map([['s1', procs(100)]]), new Map([['s1', session('s1', 'projet')]]));

    expect(await rowsOf(tree)).toEqual(['MCP servers']);
  });

  it('shows both sections once an orphan is found', async () => {
    const tree = newTree();
    tree.setProcesses(new Map([['s1', procs(100)]]), new Map([['s1', session('s1', 'projet')]]));
    tree.setOrphans([orphan(900, 'autre')]);

    expect(await rowsOf(tree)).toEqual(['MCP servers', 'No session']);
  });

  it('counts what each section holds, servers of every session together', async () => {
    const tree = newTree();
    tree.setProcesses(
      new Map([
        ['s1', procs(100)],
        ['s2', procs(200)],
      ]),
      new Map([
        ['s1', session('s1', 'projet')],
        ['s2', session('s2', 'autre')],
      ]),
    );

    const sections = await tree.getChildren();
    expect(String(tree.getTreeItem(sections[0]!).description)).toBe('4 servers');
  });
});

describe('ProcessesTree — the MCP section', () => {
  it('lists one row per server, naming the conversation it belongs to', async () => {
    const tree = newTree();
    tree.setProcesses(new Map([['s1', procs(100)]]), new Map([['s1', session('s1', 'projet')]]));

    const [mcp] = await tree.getChildren();
    const rows = await tree.getChildren(mcp);
    expect(rows.map((r) => String(tree.getTreeItem(r).label))).toEqual(['uv tool uvx alpaca-mcp-server', 'Spline spline-mcp.cjs']);
    expect(String(tree.getTreeItem(rows[0]!).description)).toContain('projet');
  });

  it('never lists the work a session is doing — that belongs to the sessions view', async () => {
    const tree = newTree();
    tree.setProcesses(new Map([['s1', procs(100)]]), new Map([['s1', session('s1', 'projet')]]));

    const [mcp] = await tree.getChildren();
    const rows = await tree.getChildren(mcp);
    expect(rows.map((r) => String(tree.getTreeItem(r).label))).not.toContain('pnpm dev');
  });

  it('unfolds a server into what it started, where its real memory shows', async () => {
    const tree = newTree();
    tree.setProcesses(new Map([['s1', procs(100)]]), new Map([['s1', session('s1', 'projet')]]));

    const [mcp] = await tree.getChildren();
    const [uv] = await tree.getChildren(mcp);
    expect(tree.getTreeItem(uv!).collapsibleState).toBe(TreeItemCollapsibleState.Collapsed);
    expect((await rowsOf(tree, uv as never)).length).toBe(1);
  });

  it('carries the same context value as a session row, so one menu serves both', async () => {
    const tree = newTree();
    tree.setProcesses(new Map([['s1', procs(100)]]), new Map([['s1', session('s1', 'projet')]]));

    const [mcp] = await tree.getChildren();
    const rows = await tree.getChildren(mcp);
    expect(tree.getTreeItem(rows[0]!).contextValue).toBe('processMcp');
  });
});

describe('ProcessesTree — the orphan section', () => {
  it('names the project a lost process was working in', async () => {
    const tree = newTree();
    tree.setOrphans([orphan(900, 'pity-tidy')]);

    const sections = await tree.getChildren();
    const rows = await tree.getChildren(sections[0]);
    const item = tree.getTreeItem(rows[0]!);
    expect(String(item.label)).toBe('zsh -c node vite; true');
    expect(String(item.description)).toContain('pity-tidy');
  });

  it('gives it its own context value: no session carries it', async () => {
    const tree = newTree();
    tree.setOrphans([orphan(900, 'pity-tidy')]);

    const sections = await tree.getChildren();
    const rows = await tree.getChildren(sections[0]);
    expect(tree.getTreeItem(rows[0]!).contextValue).toBe('orphan');
  });

  it('unfolds onto what it hides, which is usually the process that matters', async () => {
    // What the system adopted is a shell; the server holding the port is
    // under it. A row that could not be unfolded would name the shell and
    // hide the only thing worth seeing.
    const tree = newTree();
    tree.setOrphans([orphan(900, 'pity-tidy')]);

    const sections = await tree.getChildren();
    const rows = await tree.getChildren(sections[0]);
    expect(tree.getTreeItem(rows[0]!).collapsibleState).toBe(TreeItemCollapsibleState.Collapsed);
    const kids = await tree.getChildren(rows[0]);
    // Only the leading binary is shortened; the arguments stay whole, which is
    // where the project shows.
    expect(kids.map((k) => String(tree.getTreeItem(k).label))).toEqual([
      'node /Users/dev/pity-tidy/node_modules/.bin/vite',
    ]);
  });

  it('lets a menu act on a hidden child as well as on the root', async () => {
    const tree = newTree();
    tree.setOrphans([orphan(900, 'pity-tidy')]);

    const sections = await tree.getChildren();
    const rows = await tree.getChildren(sections[0]);
    const kids = await tree.getChildren(rows[0]);
    expect(tree.getTreeItem(kids[0]!).contextValue).toBe('orphan');
    expect(orphanOfNode(kids[0])).toBe(901);
  });
});

describe('ProcessesTree — redrawing', () => {
  it('does not redraw when only the ages moved a few seconds', () => {
    let redraws = 0;
    const tree = newTree();
    tree.setProcesses(new Map([['s1', procs(100)]]), new Map([['s1', session('s1', 'projet')]]));
    tree.onDidChangeTreeData(() => {
      redraws += 1;
    });

    tree.setProcesses(new Map([['s1', procs(100)]]), new Map([['s1', session('s1', 'projet')]]));

    expect(redraws).toBe(0);
  });

  it('redraws when an orphan appears', () => {
    let redraws = 0;
    const tree = newTree();
    tree.onDidChangeTreeData(() => {
      redraws += 1;
    });

    tree.setOrphans([orphan(900, 'pity-tidy')]);

    expect(redraws).toBe(1);
  });
});

describe('orphanOfNode', () => {
  it('reads an orphan row', () => {
    expect(orphanOfNode({ kind: 'orphan', orphan: orphan(900, 'p') })).toBe(900);
  });

  it('refuses anything else — the pid ends up in a kill', () => {
    expect(orphanOfNode(undefined)).toBeUndefined();
    expect(orphanOfNode({ kind: 'section' })).toBeUndefined();
    expect(orphanOfNode({ kind: 'orphan', orphan: { root: { pid: '900' } } })).toBeUndefined();
    expect(orphanOfNode({ kind: 'orphan', orphan: { root: { pid: 0 } } })).toBeUndefined();
    expect(orphanOfNode({ kind: 'orphan', orphan: {} })).toBeUndefined();
    expect(orphanOfNode({ kind: 'orphanChild', proc: { pid: -3 } })).toBeUndefined();
  });
});

describe('processNodeId', () => {
  it('gives every row a stable identity of its own', () => {
    const ids = [
      processNodeId({ kind: 'section', section: 'mcp', count: 1 }),
      processNodeId({ kind: 'section', section: 'orphans', count: 1 }),
      processNodeId({ kind: 'orphan', orphan: orphan(900, 'p') }),
      processNodeId({ kind: 'empty' }),
    ];
    expect(new Set(ids).size).toBe(ids.length);
  });
});
