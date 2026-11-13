import { describe, expect, it, vi } from 'vitest';
import { DataTransfer, DataTransferItem, ThemeIcon } from 'vscode';
import { createGroup, emptyGroups, fileArtifactsInGroup, assign, type GroupsState } from '../src/groups/model';
import { SessionsTree, folderArtifactOfNode, type TreeNode } from '../src/ui/tree';
import type { Session } from '../src/events/types';
import { DataTransfer as StubTransfer, DataTransferItem as StubItem } from './stubs/vscode';

// The Artifacts view's own type, written out: it is the contract between the two views.
const ARTIFACTS_MIME = 'application/vnd.code.tree.kohvibe.artifacts';
const noop = async (): Promise<void> => undefined;

/**
 * A transfer built the way the editor builds a drop's: several items may
 * share one type, in order. Only the stub can append — the real type has no
 * such method — hence the one cast, to the type `handleDrop` takes.
 */
function transfer(entries: readonly (readonly [string, string])[]): DataTransfer {
  const stub = new StubTransfer();
  for (const [mime, value] of entries) stub.append(mime, new StubItem(value));
  return stub as unknown as DataTransfer;
}

const session = (id: string): Session => ({
  id,
  cwd: '/Users/dev/projet',
  project: 'projet',
  origin: 'vscode',
  status: 'idle',
  toolCount: 0,
  lastEventAt: 0,
});

function state(): GroupsState {
  let s = createGroup(emptyGroups(), 'VIDEO', () => 'g1');
  s = createGroup(s, 'PRO', () => 'g2');
  s = assign(s, 's1', 'g1');
  return fileArtifactsInGroup(s, [{ slug: 'a1', title: 'Carnet' }], 'g1');
}

function tree(onArtifacts = vi.fn(noop)): SessionsTree {
  const t = new SessionsTree(async () => true, noop, noop, '/ext', onArtifacts);
  t.setSessions(new Map([['s1', session('s1')]]));
  t.setGroups(state());
  return t;
}

async function folder(t: SessionsTree, id: string): Promise<TreeNode> {
  const roots = await t.getChildren();
  const node = roots.find((n) => n.kind === 'group' && n.group?.id === id);
  if (node === undefined) throw new Error(`no folder ${id}`);
  return node;
}

describe('artifacts in a Sessions folder', () => {
  it('shows them after the conversations, past a blank row, with a book', async () => {
    const t = tree();
    const rows = await t.getChildren(await folder(t, 'g1'));
    expect(rows.map((r) => r.kind)).toEqual(['session', 'spacer', 'artifact']);
    const item = t.getTreeItem(rows[2] as TreeNode);
    expect(item.label).toBe('Carnet');
    expect(item.iconPath).toEqual(new ThemeIcon('book'));
    expect(item.contextValue).toBe('folderArtifact');
    expect(item.command?.command).toBe('kohVibe.openArtifact');
    expect(folderArtifactOfNode(rows[2])).toEqual({ slug: 'a1', groupId: 'g1' });
  });

  it('counts them in the folder description, and needs no blank row in a folder of artifacts only', async () => {
    const t = tree();
    t.setGroups(fileArtifactsInGroup(state(), [{ slug: 'a2', title: 'Deck' }], 'g2'));
    expect(t.getTreeItem(await folder(t, 'g1')).description).toBe('1 session · 1 artifact');
    expect((await t.getChildren(await folder(t, 'g2'))).map((r) => r.kind)).toEqual(['artifact']);
  });

  it('shows the live title once the Artifacts view knows it', async () => {
    const t = tree();
    t.setArtifactTitles(new Map([['a1', 'Carnet v2']]));
    const rows = await t.getChildren(await folder(t, 'g1'));
    expect(t.getTreeItem(rows[2] as TreeNode).label).toBe('Carnet v2');
  });

  it('has its folder as parent, so the search can reveal it', async () => {
    const t = tree();
    const node = t.artifactNodeFor('a1');
    expect(node).toMatchObject({ kind: 'artifact', groupId: 'g1' });
    expect(t.getParent(node as TreeNode)).toMatchObject({ kind: 'group', group: { id: 'g1' } });
    expect(t.artifactNodeFor('nope')).toBeUndefined();
  });

  it('files pages dropped from the Artifacts view in the folder they land on', async () => {
    const onArtifacts = vi.fn(noop);
    const t = tree(onArtifacts);
    const data = new DataTransfer();
    data.set(ARTIFACTS_MIME, new DataTransferItem(['b1', '__proto__']));
    await t.handleDrop(await folder(t, 'g2'), data);
    expect(onArtifacts).toHaveBeenCalledWith(['b1'], 'g2');
  });

  // What the editor really hands over when a page is dragged from the
  // Artifacts view: under that view's type, ITS description of the drag
  // first, then the slugs the Artifacts view's handleDrag set, as text.
  // Read in the editor's own code (the tree view's `drop`, and the extension
  // host's `DataTransfer`, whose `get` returns the first item only).
  const fromArtifactsView = (slugs: string[]): DataTransfer =>
    transfer([
      [ARTIFACTS_MIME, JSON.stringify({ id: 'kohVibe.artifacts', itemHandles: slugs.map((s) => `1/artifact:${s}`) })],
      [ARTIFACTS_MIME, JSON.stringify(slugs)],
    ]);

  it('files a page dragged from the Artifacts view, as the editor really delivers it', async () => {
    const onArtifacts = vi.fn(noop);
    const t = tree(onArtifacts);
    await t.handleDrop(await folder(t, 'g2'), fromArtifactsView(['b1', 'b2']));
    expect(onArtifacts).toHaveBeenCalledWith(['b1', 'b2'], 'g2');
  });

  it('files it in the folder of the conversation it is dropped on', async () => {
    const onArtifacts = vi.fn(noop);
    const t = tree(onArtifacts);
    await t.handleDrop({ kind: 'session', session: session('s1') }, fromArtifactsView(['b1']));
    expect(onArtifacts).toHaveBeenCalledWith(['b1'], 'g1');
  });

  it('skips the empty placeholder the editor sets for a declared type', async () => {
    const onArtifacts = vi.fn(noop);
    const t = tree(onArtifacts);
    const data = transfer([
      [ARTIFACTS_MIME, ''],
      [ARTIFACTS_MIME, JSON.stringify(['b1'])],
    ]);
    await t.handleDrop(await folder(t, 'g2'), data);
    expect(onArtifacts).toHaveBeenCalledWith(['b1'], 'g2');
  });

  it('files nothing when no item under the type is a list of pages', async () => {
    const onArtifacts = vi.fn(noop);
    const t = tree(onArtifacts);
    const data = transfer([[ARTIFACTS_MIME, JSON.stringify({ id: 'kohVibe.artifacts', itemHandles: [] })]]);
    await t.handleDrop(await folder(t, 'g2'), data);
    expect(onArtifacts).not.toHaveBeenCalled();
  });

  it('takes a page out of its folder when dropped on « Temporary sessions »', async () => {
    const onArtifacts = vi.fn(noop);
    const t = tree(onArtifacts);
    const data = new DataTransfer();
    t.handleDrag([{ kind: 'artifact', groupId: 'g1', artifact: { slug: 'a1', title: 'Carnet' } }], data);
    await t.handleDrop({ kind: 'group', group: undefined, sessions: [] }, data);
    expect(onArtifacts).toHaveBeenCalledWith(['a1'], undefined);
  });
});
