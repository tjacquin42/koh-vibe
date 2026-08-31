import { describe, expect, it } from 'vitest';
import { ClosedTree, closedIdOfNode, closedNodeId } from '../src/ui/closed-tree';
import type { ClosedEntry } from '../src/closed/model';

const closed = (id: string, over: Partial<ClosedEntry> = {}): ClosedEntry => ({
  id,
  cwd: '/Users/dev/projet',
  project: 'projet',
  origin: 'vscode',
  closedAt: 0,
  ...over,
});

const ids = (tree: ClosedTree): string[] => tree.getChildren().map((n) => closedNodeId(n));

describe('the recently closed view', () => {
  it('shows a loading row until the first list arrives — an empty claim before that would be a guess', () => {
    const tree = new ClosedTree();
    expect(tree.getChildren().map((n) => n.kind)).toEqual(['loading']);
    const item = tree.getTreeItem(tree.getChildren()[0]!);
    expect(item.label).toBe('Loading…');
    expect(item.iconPath).toMatchObject({ id: 'loading~spin' });
    expect(item.command).toBeUndefined();
    tree.setClosed([]);
    expect(tree.getChildren().map((n) => n.kind)).toEqual(['empty']);
  });

  it('says so, rather than showing nothing, while nothing has been closed', () => {
    const tree = new ClosedTree();
    tree.setClosed([]);
    expect(tree.getChildren().map((n) => n.kind)).toEqual(['empty']);
  });

  it('lists its entries in the order it is given, newest first', () => {
    const tree = new ClosedTree();
    tree.setClosed([closed('recent', { closedAt: 9 }), closed('older', { closedAt: 1 })]);
    expect(ids(tree)).toEqual(['closed:recent', 'closed:older']);
  });

  it('is flat: no row has children', () => {
    const tree = new ClosedTree();
    tree.setClosed([closed('a')]);
    const [row] = tree.getChildren();
    expect(tree.getChildren(row)).toEqual([]);
  });

  it('hides an entry whose conversation is alive again', () => {
    const tree = new ClosedTree();
    tree.setClosed([closed('a'), closed('b')]);
    tree.setLive(['a']);
    expect(ids(tree)).toEqual(['closed:b']);
  });

  it('falls back to the empty row when every entry is alive again', () => {
    const tree = new ClosedTree();
    tree.setClosed([closed('a')]);
    tree.setLive(['a']);
    expect(tree.getChildren().map((n) => n.kind)).toEqual(['empty']);
  });

  it('makes a row reopen on a single click, and keeps it out of the session menus', () => {
    const tree = new ClosedTree();
    tree.setClosed([closed('a', { title: 'Titre' })]);
    const [row] = tree.getChildren();
    const item = tree.getTreeItem(row!);
    expect(item.label).toBe('Titre');
    expect(item.contextValue).toBe('closedSession');
    expect(item.command?.command).toBe('kohVibe.reopenSession');
    expect(item.command?.arguments?.[0]).toMatchObject({ id: 'a' });
  });

  it('gives the empty row no command and no menu — there is nothing to act on', () => {
    const tree = new ClosedTree();
    tree.setClosed([]);
    const item = tree.getTreeItem(tree.getChildren()[0]!);
    expect(item.command).toBeUndefined();
    expect(item.contextValue).toBeUndefined();
  });

  it('redraws when the closed list changes, and stays put when it does not', () => {
    const tree = new ClosedTree();
    let fired = 0;
    tree.onDidChangeTreeData(() => {
      fired += 1;
    });
    tree.setClosed([closed('a')]);
    expect(fired).toBe(1);
    tree.setClosed([closed('a')]);
    expect(fired).toBe(1);
    tree.setClosed([closed('a'), closed('b')]);
    expect(fired).toBe(2);
  });

  it('redraws when a conversation comes back to life, since that hides its row', () => {
    const tree = new ClosedTree();
    tree.setClosed([closed('a')]);
    let fired = 0;
    tree.onDidChangeTreeData(() => {
      fired += 1;
    });
    tree.setLive(['a']);
    expect(fired).toBe(1);
    // The same live set twice: what is displayed did not move, so nothing is
    // announced — otherwise every render tick would redraw the view.
    tree.setLive(['a']);
    expect(fired).toBe(1);
  });

  it('redraws when only the title changes, even though the description text stays identical', () => {
    // A re-archive can attach a title an entry did not have before, without
    // touching project, branch or closedAt — so closedDescription() renders
    // the same string either way. Only the LABEL (sessionLabel) differs, and
    // the signature must catch that.
    const tree = new ClosedTree();
    let fired = 0;
    tree.onDidChangeTreeData(() => {
      fired += 1;
    });
    tree.setClosed([closed('a', { title: 'Titre un' })]);
    expect(fired).toBe(1);
    tree.setClosed([closed('a', { title: 'Titre deux' })]);
    expect(fired).toBe(2);
  });

  it('spins on the row being brought back, takes no second click there, and redraws for it', () => {
    const tree = new ClosedTree();
    tree.setClosed([closed('a', { title: 'Titre' }), closed('b')]);
    let fired = 0;
    tree.onDidChangeTreeData(() => {
      fired += 1;
    });
    tree.setReopening(new Set(['a']));
    expect(fired).toBe(1);
    const [a, b] = tree.getChildren();
    const waiting = tree.getTreeItem(a!);
    expect(waiting.iconPath).toMatchObject({ id: 'loading~spin' });
    expect(waiting.description).toBe('reopening…');
    // A second click started a second reopen — and a second tab.
    expect(waiting.command).toBeUndefined();
    const other = tree.getTreeItem(b!);
    expect(other.iconPath).toMatchObject({ id: 'history' });
    expect(other.command?.command).toBe('kohVibe.reopenSession');
    // The same set again: nothing moved, nothing announced.
    tree.setReopening(new Set(['a']));
    expect(fired).toBe(1);
    tree.setReopening(new Set());
    expect(fired).toBe(2);
    expect(tree.getTreeItem(tree.getChildren()[0]!).command?.command).toBe('kohVibe.reopenSession');
  });
});

// closedIdOfNode: what VSCode hands kohVibe.copySessionId when the click
// happened in this view rather than in the sessions tree.
describe('closedIdOfNode — resolves a conversation id without ever casting', () => {
  it('reads the id off a closed entry row', () => {
    expect(closedIdOfNode({ kind: 'entry', entry: closed('c1') })).toBe('c1');
  });

  it('refuses the rows that stand in for an absence, which carry no conversation', () => {
    expect(closedIdOfNode({ kind: 'empty' })).toBeUndefined();
    expect(closedIdOfNode({ kind: 'loading' })).toBeUndefined();
  });

  it('refuses a node coming from the sessions tree, whose shape is not this one', () => {
    expect(closedIdOfNode({ kind: 'session', session: { id: 's1' } })).toBeUndefined();
  });

  it('refuses anything that is not an object, because VSCode passes the item as is', () => {
    for (const value of [undefined, null, 'c1', 42, []]) expect(closedIdOfNode(value)).toBeUndefined();
  });

  it('refuses an entry whose id is not a string', () => {
    expect(closedIdOfNode({ kind: 'entry', entry: { id: 42 } })).toBeUndefined();
  });
});
