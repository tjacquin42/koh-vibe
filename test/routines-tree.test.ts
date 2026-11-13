import { describe, expect, it } from 'vitest';
import type { FeedView } from '../src/cloud/feed';
import type { Routine } from '../src/routines/model';
import { RoutinesTree, routineIdOfNode, routineNodeId, type RoutineNode } from '../src/ui/routines-tree';
import { TreeItemCollapsibleState } from './stubs/vscode';

const at = (y: number, m: number, d: number, h = 12, min = 0): number => new Date(y, m - 1, d, h, min).getTime();
const NOW = at(2026, 9, 28, 10, 0);

const routine = (over: Partial<Routine> = {}): Routine => ({
  id: 'r',
  name: 'R',
  enabled: true,
  cron: '0 6 * * *',
  fired: false,
  repos: [],
  ...over,
});

const ready = (items: Routine[]): FeedView<Routine> => ({ kind: 'ready', snapshot: { at: NOW, items, truncated: false } });

const treeOf = (view: FeedView<Routine>): RoutinesTree => {
  const tree = new RoutinesTree();
  tree.setFeed(view, NOW, 'fr');
  return tree;
};

describe('the routines view', () => {
  it('shows a loading row before anything was read', () => {
    const tree = new RoutinesTree();
    const [row] = tree.getChildren();
    expect(row?.kind).toBe('loading');
    expect(tree.getTreeItem(row!).iconPath).toMatchObject({ id: 'loading~spin' });
  });

  it('turns a failed read into a row that retries when clicked', () => {
    for (const kind of ['signed-out', 'unavailable'] as const) {
      const tree = treeOf({ kind });
      const [row] = tree.getChildren();
      expect(row?.kind).toBe(kind);
      expect(tree.getTreeItem(row!).command?.command).toBe('kohVibe.refreshRoutines');
    }
  });

  it('says so when there is no routine', () => {
    expect(treeOf(ready([])).getChildren().map((n) => n.kind)).toEqual(['empty']);
  });

  it('groups the routines, Paused folded away', () => {
    const tree = treeOf(ready([routine({ id: 'p', enabled: false }), routine({ id: 't', nextRunAt: at(2026, 9, 28, 14) })]));
    const sections = tree.getChildren();
    expect(sections.map(routineNodeId)).toEqual(['routines:today', 'routines:paused']);
    expect(sections.map((s) => tree.getTreeItem(s).collapsibleState)).toEqual([
      TreeItemCollapsibleState.Expanded,
      TreeItemCollapsibleState.Collapsed,
    ]);
    expect(tree.getTreeItem(sections[0]!).description).toBe('1');
    expect(tree.getChildren(sections[1]).map(routineNodeId)).toEqual(['routine:p']);
  });

  it('gives each row the buttons its state allows, and opens it on click', () => {
    const tree = treeOf(
      ready([
        routine({ id: 'on', nextRunAt: at(2026, 9, 28, 14) }),
        routine({ id: 'off', enabled: false }),
        routine({ id: 'spent', cron: undefined, enabled: false, fired: true }),
        // Paused before its date, which has passed since: resuming it could fire it at once, unconfirmed.
        routine({ id: 'past', cron: undefined, enabled: false, runOnceAt: at(2026, 9, 27, 8) }),
        routine({ id: 'ahead', cron: undefined, enabled: false, runOnceAt: at(2026, 9, 29, 8) }),
      ]),
    );
    const rows = tree.getChildren().flatMap((s) => tree.getChildren(s));
    const items = rows.map((r) => tree.getTreeItem(r));
    expect(items.map((i) => i.contextValue)).toEqual([
      'routine.enabled',
      'routine.paused',
      'routine.spent',
      'routine.spent',
      'routine.paused',
    ]);
    expect(items[0]?.command).toMatchObject({ command: 'kohVibe.openRoutine', arguments: [rows[0]] });
    expect(items[0]?.description).toBe('14:00');
  });

  it('acts on the list on screen: a routine gone since the row was drawn is not found', () => {
    const tree = treeOf(ready([routine({ id: 'kept' })]));
    expect(tree.routine('kept')?.id).toBe('kept');
    expect(tree.routine('gone')).toBeUndefined();
  });

  it('redraws only when what it shows changed', () => {
    const tree = new RoutinesTree();
    let fired = 0;
    tree.onDidChangeTreeData(() => {
      fired += 1;
    });
    tree.setFeed(ready([routine({ nextRunAt: at(2026, 9, 28, 14) })]), NOW, 'fr');
    tree.setFeed(ready([routine({ nextRunAt: at(2026, 9, 28, 14) })]), NOW + 60_000, 'fr');
    expect(fired).toBe(1);
    tree.setFeed(ready([routine({ name: 'Renamed', nextRunAt: at(2026, 9, 28, 14) })]), NOW, 'fr');
    expect(fired).toBe(2);
  });
});

describe('routineIdOfNode', () => {
  it('reads the id of a routine row, and nothing else', () => {
    const node: RoutineNode = { kind: 'routine', routine: routine({ id: 'trig_test_01' }), group: 'today' };
    expect(routineIdOfNode(node)).toBe('trig_test_01');
    for (const v of [undefined, null, 'trig', { kind: 'section', group: 'today', count: 1 }, { kind: 'routine', routine: { id: 4 } }]) {
      expect(routineIdOfNode(v)).toBeUndefined();
    }
  });
});
