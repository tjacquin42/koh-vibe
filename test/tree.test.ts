import { describe, expect, it, vi } from 'vitest';
import { SessionsTree, groupIdOfNode, nodeId } from '../src/ui/tree';
import type { TreeNode } from '../src/ui/tree';
import type { Session } from '../src/events/types';
import type { GroupsState } from '../src/groups/model';

// The package root, from which the view draws its status dots. A fake path
// is enough here: what is verified is the SHAPE of the iconPath, not the
// files' content — test/status-icon.test.ts, for its part, makes sure they exist.
const EXT = '/ext';

const session = (id: string, overrides: Partial<Session> = {}): Session => ({
  id,
  cwd: '/Users/dev/projet',
  project: 'projet',
  origin: 'vscode',
  status: 'idle',
  toolCount: 0,
  lastEventAt: 0,
  ...overrides,
});

const groups = (state: Partial<GroupsState>): GroupsState => ({
  groups: [],
  assignments: {},
  sessionOrder: {},
  sessionSounds: { waiting: {}, done: {} },
  unknown: {},
  ...state,
});

// onDrop is mandatory in the constructor: these tests are about the display,
// not about drag-and-drop, so a stub with no shared effect is enough here.
const noopOnDrop = async (): Promise<void> => undefined;
const noopOnGroupsDropped = async (): Promise<void> => undefined;

// The tests assert the list of labels actually rendered (via getTreeItem),
// not a mere node count: a count says nothing about the order or the
// content, two properties these rules explicitly carry.
const labelsOf = async (tree: SessionsTree, node?: TreeNode): Promise<string[]> => {
  const children = await tree.getChildren(node);
  return children.map((child) => String(tree.getTreeItem(child).label));
};

const bodyOf = async (tree: SessionsTree): Promise<TreeNode[]> => tree.getChildren();

// I5: the « hooks installed » state must only be recomputed when it is
// actually consulted — that is, when the tree is about to show its empty
// node, so only when there is no session to show. Two properties verified:
// the cost is only paid in that case, and the symptom (the tree shows « not
// installed » when sessions already exist) disappears by construction since
// the check is not even consulted when sessions are there.
describe('SessionsTree — hooksInstalled recomputed on demand (I5)', () => {
  it("does not query the hooks state when there are sessions to display, even if they are actually uninstalled", async () => {
    const checkHooksInstalled = vi.fn().mockResolvedValue(false);
    const tree = new SessionsTree(checkHooksInstalled, noopOnDrop, noopOnGroupsDropped, EXT);
    tree.setSessions(new Map([['s1', session('s1')]]));

    const children = await bodyOf(tree);

    expect(checkHooksInstalled).not.toHaveBeenCalled();
    expect(children).toEqual([{ kind: 'group', group: undefined, sessions: [session('s1')] }]);
  });

  it("queries the hooks state only when there is no session at all, and shows the installation node if they are missing", async () => {
    const checkHooksInstalled = vi.fn().mockResolvedValue(false);
    const tree = new SessionsTree(checkHooksInstalled, noopOnDrop, noopOnGroupsDropped, EXT);

    const children = await bodyOf(tree);

    expect(checkHooksInstalled).toHaveBeenCalledTimes(1);
    expect(children).toEqual([
      { kind: 'empty', message: 'Hooks not installed — click to install them', action: 'install' },
    ]);
  });

  it("a render with no session reflects an installation done in the meantime, without a window reload", async () => {
    const checkHooksInstalled = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const tree = new SessionsTree(checkHooksInstalled, noopOnDrop, noopOnGroupsDropped, EXT);

    const before = await bodyOf(tree);
    expect(before).toEqual([
      { kind: 'empty', message: 'Hooks not installed — click to install them', action: 'install' },
    ]);

    const after = await bodyOf(tree);

    expect(after).toEqual([{ kind: 'empty', message: 'No active Claude Code session' }]);
    expect(checkHooksInstalled).toHaveBeenCalledTimes(2);
  });

  it("setHooksInstalled redraws the empty row: an installation observed by the render is visible without a reload, even when nothing else changes", async () => {
    const checkHooksInstalled = vi.fn().mockResolvedValue(false);
    const tree = new SessionsTree(checkHooksInstalled, noopOnDrop, noopOnGroupsDropped, EXT);
    let fired = 0;
    tree.onDidChangeTreeData(() => {
      fired += 1;
    });

    tree.setSessions(new Map());
    expect(await bodyOf(tree)).toEqual([
      { kind: 'empty', message: 'Hooks not installed — click to install them', action: 'install' },
    ]);

    const before = fired;
    tree.setHooksInstalled(true);

    // The observed value is part of the signature: the change triggers a
    // redraw, and getChildren consults it without going back through the checker.
    expect(fired).toBe(before + 1);
    expect(await bodyOf(tree)).toEqual([{ kind: 'empty', message: 'No active Claude Code session' }]);
    expect(checkHooksInstalled).toHaveBeenCalledTimes(1);
  });

  it('never consults the hooks again once sessions appear (the I5 symptom disappears by construction)', async () => {
    const checkHooksInstalled = vi.fn().mockResolvedValue(false);
    const tree = new SessionsTree(checkHooksInstalled, noopOnDrop, noopOnGroupsDropped, EXT);

    await tree.getChildren(); // no session: queries, shows « not installed »
    tree.setSessions(new Map([['s1', session('s1')]]));
    const children = await bodyOf(tree);

    expect(children).toEqual([{ kind: 'group', group: undefined, sessions: [session('s1')] }]);
    expect(checkHooksInstalled).toHaveBeenCalledTimes(1); // not a second call
  });
});

describe('SessionsTree — two levels: folders then sessions', () => {
  it('files the sessions under their folder, in the order of the folders', async () => {
    const tree = new SessionsTree(() => Promise.resolve(true), noopOnDrop, noopOnGroupsDropped, EXT);
    tree.setSessions(
      new Map([
        ['s1', session('s1', { project: 'alpha' })],
        ['s2', session('s2', { project: 'beta' })],
      ]),
    );
    tree.setGroups(
      groups({
        groups: [
          { id: 'g-perso', name: 'Perso', order: 0 },
          { id: 'g-taf', name: 'Taf', order: 1 },
        ],
        assignments: { s1: 'g-taf', s2: 'g-perso' },
      }),
    );

    expect(await labelsOf(tree)).toEqual(['Perso', '', 'Taf']);

    const [persoNode, , tafNode] = await tree.getChildren();
    expect(await labelsOf(tree, persoNode)).toEqual(['beta']);
    expect(await labelsOf(tree, tafNode)).toEqual(['alpha']);
  });

  it('« Unfiled » always comes last', async () => {
    const tree = new SessionsTree(() => Promise.resolve(true), noopOnDrop, noopOnGroupsDropped, EXT);
    tree.setSessions(
      new Map([
        ['s1', session('s1', { project: 'alpha' })],
        ['s2', session('s2', { project: 'beta' })],
      ]),
    );
    tree.setGroups(
      groups({
        groups: [{ id: 'g1', name: 'Dossier unique', order: 0 }],
        assignments: { s1: 'g1' }, // s2 stays unfiled
      }),
    );

    expect(await labelsOf(tree)).toEqual(['Dossier unique', '', 'Temporary sessions']);
  });

  it('« Unfiled » disappears once every session is filed', async () => {
    const tree = new SessionsTree(() => Promise.resolve(true), noopOnDrop, noopOnGroupsDropped, EXT);
    tree.setSessions(new Map([['s1', session('s1')]]));
    tree.setGroups(
      groups({
        groups: [{ id: 'g1', name: 'Dossier', order: 0 }],
        assignments: { s1: 'g1' },
      }),
    );

    expect(await labelsOf(tree)).toEqual(['Dossier']);
  });

  it('an empty folder stays visible, so it can be dropped into', async () => {
    const tree = new SessionsTree(() => Promise.resolve(true), noopOnDrop, noopOnGroupsDropped, EXT);
    tree.setSessions(new Map([['s1', session('s1')]])); // unfiled
    tree.setGroups(
      groups({
        groups: [{ id: 'g1', name: 'Dossier vide', order: 0 }],
      }),
    );

    expect(await labelsOf(tree)).toEqual(['Dossier vide', '', 'Temporary sessions']);

    const [emptyGroupNode] = await tree.getChildren();
    expect(await labelsOf(tree, emptyGroupNode)).toEqual([]);
  });

  it('sorts a folder\'s sessions by status then by recency, like the global list', async () => {
    const tree = new SessionsTree(() => Promise.resolve(true), noopOnDrop, noopOnGroupsDropped, EXT);
    tree.setSessions(
      new Map([
        ['s1', session('s1', { project: 'idle-old', status: 'idle', lastEventAt: 100 })],
        ['s2', session('s2', { project: 'waiting', status: 'waiting', lastEventAt: 50 })],
        ['s3', session('s3', { project: 'termine', status: 'done_unseen', lastEventAt: 50 })],
        ['s4', session('s4', { project: 'idle-new', status: 'idle', lastEventAt: 200 })],
      ]),
    );
    tree.setGroups(
      groups({
        groups: [{ id: 'g1', name: 'Dossier', order: 0 }],
        assignments: { s1: 'g1', s2: 'g1', s3: 'g1', s4: 'g1' },
      }),
    );

    const [groupNode] = await tree.getChildren();
    expect(await labelsOf(tree, groupNode)).toEqual(['waiting', 'termine', 'idle-new', 'idle-old']);
  });

  it('gives a distinct contextValue to a real folder and to « Unfiled »', async () => {
    const tree = new SessionsTree(() => Promise.resolve(true), noopOnDrop, noopOnGroupsDropped, EXT);
    tree.setSessions(new Map([['s1', session('s1')], ['s2', session('s2')]]));
    tree.setGroups(
      groups({
        groups: [{ id: 'g1', name: 'Dossier', order: 0 }],
        assignments: { s1: 'g1' }, // s2 stays unfiled
      }),
    );

    const [groupNode, , unfiledNode] = await tree.getChildren();
    expect(tree.getTreeItem(groupNode!).contextValue).toBe('group');
    expect(tree.getTreeItem(unfiledNode!).contextValue).toBe('unfiled');
  });

  it('the global empty state is unchanged when there is no session at all', async () => {
    const checkHooksInstalled = vi.fn().mockResolvedValue(true);
    const tree = new SessionsTree(checkHooksInstalled, noopOnDrop, noopOnGroupsDropped, EXT);
    tree.setGroups(groups({ groups: [{ id: 'g1', name: 'Dossier', order: 0 }] }));

    const children = await bodyOf(tree);

    expect(children).toEqual([{ kind: 'empty', message: 'No active Claude Code session' }]);
    expect(checkHooksInstalled).toHaveBeenCalledTimes(1);
  });
});

// groupIdOfNode: what VSCode passes to kohVibe.renameGroup/deleteGroup from
// the context menu (view/item/context) is the tree element as it is, never a
// TreeItem — so anything at all from TypeScript's typing point of view.
// These tests cover the validation without a cast, like handleDrop in
// test/tree-dnd.test.ts.
describe('groupIdOfNode — resolves a folder identifier without ever casting', () => {
  it("finds the identifier of a named folder node", () => {
    const node: TreeNode = { kind: 'group', group: { id: 'g1', name: 'Perso', order: 0 }, sessions: [] };

    expect(groupIdOfNode(node)).toBe('g1');
  });

  it('returns undefined for « Unfiled » (group: undefined)', () => {
    const node: TreeNode = { kind: 'group', group: undefined, sessions: [] };

    expect(groupIdOfNode(node)).toBeUndefined();
  });

  it('returns undefined for a session node', () => {
    const node: TreeNode = {
      kind: 'session',
      session: {
        id: 's1',
        cwd: '/Users/dev/projet',
        project: 'projet',
        origin: 'vscode',
        status: 'idle',
        toolCount: 0,
        lastEventAt: 0,
      },
    };

    expect(groupIdOfNode(node)).toBeUndefined();
  });

  it('returns undefined for an empty node', () => {
    expect(groupIdOfNode({ kind: 'empty', message: 'No active Claude Code session' })).toBeUndefined();
  });

  it.each([undefined, null, 'g1', 42, []])('returns undefined for a non-object value: %p', (value) => {
    expect(groupIdOfNode(value)).toBeUndefined();
  });

  it("returns undefined when group.id is not a string", () => {
    expect(groupIdOfNode({ kind: 'group', group: { id: 42, name: 'x', order: 0 } })).toBeUndefined();
  });

  // Proof by mutation (Task 9 review, round 2): without this test, removing
  // `candidate.kind !== 'group' ||` still leaves the other tests in this
  // block green — none of them combines a `kind` other than `'group'` with
  // an otherwise valid `group.id`, so nothing actually depended on this half
  // of the guard. A malformed object (no real TreeNode shape carries both
  // `kind: 'session'` and a `group` field) is enough to prove it: without
  // the check on `kind`, the only remaining condition (`group !== undefined`)
  // would let 'g1' through.
  it('ignores a valid group.id carried by a node whose kind is not "group"', () => {
    expect(groupIdOfNode({ kind: 'session', group: { id: 'g1', name: 'x', order: 0 } })).toBeUndefined();
  });
});

describe('SessionsTree — folder spacing and colour', () => {
  const withGroups = (list: Array<{ id: string; name: string; order: number; color?: string }>): SessionsTree => {
    const tree = new SessionsTree(() => Promise.resolve(true), noopOnDrop, noopOnGroupsDropped, EXT);
    tree.setSessions(new Map([['s1', session('s1')]]));
    tree.setGroups(groups({ groups: list, assignments: { s1: list[0]?.id ?? 'g-1' } }));
    return tree;
  };

  it('separates folders with a blank line, never before the first one nor after the last', async () => {
    const tree = withGroups([
      { id: 'g-1', name: 'Un', order: 0 },
      { id: 'g-2', name: 'Deux', order: 1 },
      { id: 'g-3', name: 'Trois', order: 2 },
    ]);
    expect(await labelsOf(tree)).toEqual(['Un', '', 'Deux', '', 'Trois']);
  });

  it('adds no line when there is only a single folder', async () => {
    const tree = withGroups([{ id: 'g-1', name: 'Seul', order: 0 }]);
    expect(await labelsOf(tree)).toEqual(['Seul']);
  });

  it('gives spacers distinct identities — two identical nodes would stomp on each other', async () => {
    const tree = withGroups([
      { id: 'g-1', name: 'Un', order: 0 },
      { id: 'g-2', name: 'Deux', order: 1 },
      { id: 'g-3', name: 'Trois', order: 2 },
    ]);
    // The view's footer brings a third one, which separates it from the settings list.
    const spacers = (await bodyOf(tree)).filter((n) => n.kind === 'spacer');
    expect(spacers).toHaveLength(2);
    expect(new Set(spacers.map((n) => (n.kind === 'spacer' ? n.after : ''))).size).toBe(2);
  });

  it('makes the separator neither clickable nor a target for a menu', async () => {
    const tree = withGroups([
      { id: 'g-1', name: 'Un', order: 0 },
      { id: 'g-2', name: 'Deux', order: 1 },
    ]);
    const [, spacer] = await tree.getChildren();
    const item = tree.getTreeItem(spacer!);
    expect(item.command).toBeUndefined();
    expect(item.contextValue).toBeUndefined();
    expect(await tree.getChildren(spacer)).toEqual([]);
  });

  it('colours the folder icon with the chosen colour', async () => {
    const tree = withGroups([{ id: 'g-1', name: 'Un', order: 0, color: 'green' }]);
    const [node] = await tree.getChildren();
    const icon = tree.getTreeItem(node!).iconPath as { id: string; color?: { id: string } };
    expect(icon.id).toBe('symbol-folder');
    expect(icon.color?.id).toBe('charts.green');
  });

  it('shows a folder with no colour when it has no choice, or one whose colour we do not know', async () => {
    for (const color of [undefined, 'turquoise']) {
      const tree = withGroups([{ id: 'g-1', name: 'Un', order: 0, color }]);
      const [node] = await tree.getChildren();
      const icon = tree.getTreeItem(node!).iconPath as { id: string; color?: { id: string } };
      expect(icon.id).toBe('symbol-folder');
      expect(icon.color).toBeUndefined();
    }
  });

  it('does not colour « Unfiled », which carries no choice of the user\'s own', async () => {
    const tree = new SessionsTree(() => Promise.resolve(true), noopOnDrop, noopOnGroupsDropped, EXT);
    tree.setSessions(new Map([['s1', session('s1')]]));
    tree.setGroups(groups({ groups: [] }));
    const [node] = await tree.getChildren();
    const icon = tree.getTreeItem(node!).iconPath as { id: string; color?: { id: string } };
    expect(icon.color).toBeUndefined();
  });
});

describe('SessionsTree — the colour preview, while the list is open', () => {
  const iconColorOf = (tree: SessionsTree, node: TreeNode): string | undefined =>
    (tree.getTreeItem(node).iconPath as { color?: { id: string } }).color?.id;

  const twoFolders = (): SessionsTree => {
    const tree = new SessionsTree(() => Promise.resolve(true), noopOnDrop, noopOnGroupsDropped, EXT);
    tree.setSessions(new Map([['s1', session('s1')], ['s2', session('s2')]]));
    tree.setGroups(
      groups({
        groups: [
          { id: 'g-1', name: 'Un', order: 0, color: 'green' },
          { id: 'g-2', name: 'Deux', order: 1, color: 'red' },
        ],
        assignments: { s1: 'g-1', s2: 'g-2' },
      }),
    );
    return tree;
  };

  it('shows the browsed colour on the folder, before any confirmation', async () => {
    const tree = twoFolders();
    tree.setPreview('g-1', 'blue');
    const [node] = await tree.getChildren();
    expect(iconColorOf(tree, node!)).toBe('charts.blue');
  });

  it('colours the LABEL too, and not just the icon', async () => {
    // The label goes through a resourceUri: without it, half the row would
    // keep the old colour while the list is being browsed.
    const tree = twoFolders();
    tree.setPreview('g-1', 'blue');
    const [node] = await tree.getChildren();
    expect(tree.getTreeItem(node!).resourceUri?.query).toContain('charts.blue');
  });

  it('leaves the other folders on their own colour', async () => {
    const tree = twoFolders();
    tree.setPreview('g-1', 'blue');
    const body = await tree.getChildren();
    const other = body.find((n) => n.kind === 'group' && n.group?.id === 'g-2');
    expect(iconColorOf(tree, other!)).toBe('charts.red');
  });

  it('really uncolours the folder when browsing to "None"', async () => {
    // A preview of a removal is a preview like any other: without it, one
    // would confirm "None" without ever having seen what that looks like.
    const tree = twoFolders();
    tree.setPreview('g-1', undefined);
    const [node] = await tree.getChildren();
    expect(iconColorOf(tree, node!)).toBeUndefined();
    expect(tree.getTreeItem(node!).resourceUri).toBeUndefined();
  });

  it('gives the folder back its colour as soon as the list closes', async () => {
    const tree = twoFolders();
    tree.setPreview('g-1', 'blue');
    tree.clearPreview();
    const [node] = await tree.getChildren();
    expect(iconColorOf(tree, node!)).toBe('charts.green');
  });

  it('notifies VSCode at every step — otherwise the preview would never be seen', () => {
    // `refresh` only signals what CHANGES ON SCREEN: the preview must
    // therefore be part of its signature, or the overlay would stay invisible.
    const tree = twoFolders();
    const seen = vi.fn();
    tree.onDidChangeTreeData(seen);
    tree.setPreview('g-1', 'blue');
    tree.setPreview('g-1', 'red');
    tree.clearPreview();
    expect(seen).toHaveBeenCalledTimes(3);
  });

  it('signals nothing when there is no preview to remove', () => {
    const tree = twoFolders();
    const seen = vi.fn();
    tree.onDidChangeTreeData(seen);
    tree.clearPreview();
    expect(seen).not.toHaveBeenCalled();
  });

  it('does not touch the colour the folder HOLDS, only the one it shows', async () => {
    // The overlay is presentation, and nothing else: the colour actually
    // filed stays the one from the classification, for lack of which a
    // colour merely hovered over would end up in the shared file — and in
    // the other editor.
    const tree = twoFolders();
    tree.setPreview('g-1', 'blue');
    const [node] = await tree.getChildren();
    expect(node!.kind === 'group' && node!.group?.color).toBe('green');
    expect(iconColorOf(tree, node!)).toBe('charts.blue');
  });
});

describe('SessionsTree — hand-picked order', () => {
  const three = (): Map<string, Session> =>
    new Map([
      ['s1', session('s1', { project: 'un', status: 'idle', lastEventAt: 30 })],
      ['s2', session('s2', { project: 'deux', status: 'idle', lastEventAt: 20 })],
      ['s3', session('s3', { project: 'trois', status: 'idle', lastEventAt: 10 })],
    ]);

  const treeWith = (sessionOrder: Record<string, readonly string[]>): SessionsTree => {
    const tree = new SessionsTree(() => Promise.resolve(true), noopOnDrop, noopOnGroupsDropped, EXT);
    tree.setSessions(three());
    tree.setGroups(
      groups({
        groups: [{ id: 'g1', name: 'Dossier', order: 0 }],
        assignments: { s1: 'g1', s2: 'g1', s3: 'g1' },
        sessionOrder,
      }),
    );
    return tree;
  };

  it('with no order chosen, keeps the dashboard\'s sort order', async () => {
    const [group] = await treeWith({}).getChildren();
    expect(await labelsOf(treeWith({}), group)).toEqual(['un', 'deux', 'trois']);
  });

  it('respects the chosen order, whatever the default sort order', async () => {
    const tree = treeWith({ g1: ['s3', 's1', 's2'] });
    const [group] = await tree.getChildren();
    expect(await labelsOf(tree, group)).toEqual(['trois', 'un', 'deux']);
  });

  it('does not move when a status changes — that is the whole point of a fixed order', async () => {
    const tree = treeWith({ g1: ['s3', 's1', 's2'] });
    const bumped = three();
    // s2 jumps to the head of the default sort (it is waiting for you): the chosen order holds.
    bumped.set('s2', session('s2', { project: 'deux', status: 'waiting', lastEventAt: 99 }));
    tree.setSessions(bumped);
    const [group] = await tree.getChildren();
    expect(await labelsOf(tree, group)).toEqual(['trois', 'un', 'deux']);
  });

  it('places at the end a session the order does not name, without disturbing the others', async () => {
    const tree = treeWith({ g1: ['s3', 's1'] });
    const [group] = await tree.getChildren();
    expect(await labelsOf(tree, group)).toEqual(['trois', 'un', 'deux']);
  });

  it('ignores an identifier that matches no live session', async () => {
    const tree = treeWith({ g1: ['fantome', 's2'] });
    const [group] = await tree.getChildren();
    expect(await labelsOf(tree, group)).toEqual(['deux', 'un', 'trois']);
  });

  it('also orders « Unfiled »', async () => {
    const tree = new SessionsTree(() => Promise.resolve(true), noopOnDrop, noopOnGroupsDropped, EXT);
    tree.setSessions(three());
    tree.setGroups(groups({ sessionOrder: { '': ['s3', 's2', 's1'] } }));
    const [unfiled] = await tree.getChildren();
    expect(await labelsOf(tree, unfiled)).toEqual(['trois', 'deux', 'un']);
  });

  it('does not mix a folder\'s order with that of « Unfiled »', async () => {
    const tree = new SessionsTree(() => Promise.resolve(true), noopOnDrop, noopOnGroupsDropped, EXT);
    tree.setSessions(three());
    tree.setGroups(
      groups({
        groups: [{ id: 'g1', name: 'Dossier', order: 0 }],
        assignments: { s1: 'g1' },
        sessionOrder: { g1: ['s1'], '': ['s3', 's2'] },
      }),
    );
    const [group, , unfiled] = await tree.getChildren();
    expect(await labelsOf(tree, group)).toEqual(['un']);
    expect(await labelsOf(tree, unfiled)).toEqual(['trois', 'deux']);
  });
});

describe('SessionsTree — status dots', () => {
  const iconOf = (status: Session['status']) => {
    const tree = new SessionsTree(() => Promise.resolve(true), noopOnDrop, noopOnGroupsDropped, EXT);
    tree.setSessions(new Map([['s1', session('s1', { status })]]));
    tree.setGroups(groups({}));
    const item = tree.getTreeItem({ kind: 'session', session: session('s1', { status }) });
    return item.iconPath as { light: { fsPath: string }; dark: { fsPath: string } };
  };

  const ALL: Array<Session['status']> = ['running', 'waiting', 'done_unseen', 'idle'];

  it('gives a dot to EVERY status, with no exception', () => {
    // The invariant this test guards: a status with no dot leaves a row
    // whose state cannot be read anywhere, and whose label starts further
    // left than the others'.
    for (const status of ALL) {
      expect(iconOf(status).light.fsPath, `statut ${status}`).toMatch(/\.svg$/);
      expect(iconOf(status).dark.fsPath, `statut ${status}`).toMatch(/\.svg$/);
    }
  });

  it('NEVER uses a codicon, which selection would wash out', () => {
    // The heart of the matter. VSCode forces `color: currentColor !important`
    // on the icon of a selected row — but only if it is a codicon. The dot
    // therefore lost its colour at the exact moment the session was clicked,
    // and its state became unreadable. An image escapes that.
    for (const status of ALL) {
      const icon = iconOf(status) as unknown as { id?: string };
      expect(icon.id, `statut ${status}`).toBeUndefined();
    }
  });

  it('tells statuses apart by the file, never by the shape', () => {
    // It is alignment that demands it: different shapes did not sit at the
    // same spot in the row, and the label inherited the offset. The five
    // dots are the same disc; only the colour changes, and it lives in the
    // file. The status, for its part, is named in the tooltip.
    const fichiers = ALL.map((s) => iconOf(s).dark.fsPath);
    expect(new Set(fichiers).size).toBe(ALL.length);
  });
});

describe('SessionsTree — colour reaches the label, not just the icon', () => {
  const colored = (): SessionsTree => {
    const tree = new SessionsTree(() => Promise.resolve(true), noopOnDrop, noopOnGroupsDropped, EXT);
    tree.setSessions(new Map([['s1', session('s1')], ['s2', session('s2')]]));
    tree.setGroups(
      groups({
        groups: [
          { id: 'g1', name: 'Coloré', order: 0, color: 'green' },
          { id: 'g2', name: 'Sans couleur', order: 1 },
        ],
        assignments: { s1: 'g1', s2: 'g2' },
      }),
    );
    return tree;
  };

  it('sets a decoration URI on the coloured folder', async () => {
    const [group] = await colored().getChildren();
    const uri = colored().getTreeItem(group!).resourceUri as { scheme: string; query: string } | undefined;
    expect(uri?.scheme).toBe('koh-vibe');
    expect(uri?.query).toBe('c=charts.green');
  });

  it('NEVER colours a session, even in a coloured folder', async () => {
    // Two reasons, and the second one is a trap: the folder's tint repeated
    // on every conversation drowned out readability, and the resourceUri it
    // required offset the label of those rows relative to the others.
    const tree = colored();
    const [group] = await tree.getChildren();
    for (const child of await tree.getChildren(group!)) {
      expect(tree.getTreeItem(child).resourceUri).toBeUndefined();
    }
  });

  it('sets no URI on a colourless folder, nor on its sessions', async () => {
    const tree = colored();
    const children = await tree.getChildren();
    const plain = children[2];
    expect(tree.getTreeItem(plain!).resourceUri).toBeUndefined();
    const [child] = await tree.getChildren(plain!);
    expect(tree.getTreeItem(child!).resourceUri).toBeUndefined();
  });
});

describe('SessionsTree — only notifies VSCode if the display changed', () => {
  const listen = (tree: SessionsTree): { count: () => number } => {
    let n = 0;
    tree.onDidChangeTreeData(() => {
      n += 1;
    });
    return { count: () => n };
  };

  it('signals nothing when the render is identical', async () => {
    // The bug this test guards: the render runs every two seconds and calls
    // four setters. Signalling every time made the tree get rebuilt twice a
    // second, which whisked the tooltip out from under the mouse before one
    // had finished reading it.
    const tree = new SessionsTree(() => Promise.resolve(true), noopOnDrop, noopOnGroupsDropped, EXT);
    const map = new Map([['s1', session('s1', { lastEventAt: 1000 })]]);
    tree.setSessions(map);
    const heard = listen(tree);

    for (let i = 0; i < 10; i++) {
      tree.setSessions(new Map([['s1', session('s1', { lastEventAt: 1000 })]]));
      tree.setGroups(groups({}));
        }

    expect(heard.count()).toBe(0);
  });

  it('signals as soon as a status changes', () => {
    const tree = new SessionsTree(() => Promise.resolve(true), noopOnDrop, noopOnGroupsDropped, EXT);
    tree.setSessions(new Map([['s1', session('s1', { status: 'idle' })]]));
    const heard = listen(tree);
    tree.setSessions(new Map([['s1', session('s1', { status: 'waiting' })]]));
    expect(heard.count()).toBe(1);
  });

  it('signals as soon as a folder changes name or colour', () => {
    const tree = new SessionsTree(() => Promise.resolve(true), noopOnDrop, noopOnGroupsDropped, EXT);
    tree.setSessions(new Map([['s1', session('s1')]]));
    tree.setGroups(groups({ groups: [{ id: 'g1', name: 'Un', order: 0 }] }));
    const heard = listen(tree);
    tree.setGroups(groups({ groups: [{ id: 'g1', name: 'Un', order: 0, color: 'green' }] }));
    expect(heard.count()).toBe(1);
    tree.setGroups(groups({ groups: [{ id: 'g1', name: 'Deux', order: 0, color: 'green' }] }));
    expect(heard.count()).toBe(2);
  });

  it('signals when the displayed age crosses a minute, not every second', () => {
    const tree = new SessionsTree(() => Promise.resolve(true), noopOnDrop, noopOnGroupsDropped, EXT);
    const now = Date.now();
    tree.setSessions(new Map([['s1', session('s1', { status: 'idle', lastEventAt: now - 30_000 })]]));
    const heard = listen(tree);
    // Still « 3x s »: nothing to announce.
    tree.setSessions(new Map([['s1', session('s1', { status: 'idle', lastEventAt: now - 31_000 })]]));
    expect(heard.count()).toBe(0);
    // Crosses the minute: the display changes, so it is announced.
    tree.setSessions(new Map([['s1', session('s1', { status: 'idle', lastEventAt: now - 61_000 })]]));
    expect(heard.count()).toBe(1);
  });
});

describe('row identity — what lets a tooltip survive', () => {
  it('gives each row a stable identifier, distinct from its neighbours', () => {
    // Without `id`, VSCode recognizes a row by the OBJECT rendered by
    // getChildren, and we build fresh ones on every pass: a single refresh
    // made it destroy and remake EVERY row, sweeping away the tooltip one
    // was in the middle of reading.
    const s = session('s1', { status: 'running' });
    const group = { kind: 'group' as const, group: { id: 'g1', name: 'Perso', order: 0 }, sessions: [s] };
    expect(nodeId(group)).toBe('group:g1');
    expect(nodeId({ kind: 'session', session: s })).toBe('session:s1');
    expect(nodeId({ kind: 'spacer', after: 'g2' })).toBe('spacer:g2');
    expect(nodeId({ kind: 'group', group: undefined, sessions: [] })).toBe('group:unfiled');
    expect(nodeId({ kind: 'empty', message: 'rien' })).toBe('empty');
  });

  it('sets this identifier on the rendered element, not only in the function', () => {
    const tree = new SessionsTree(
      async () => true,
      async () => undefined,
      noopOnGroupsDropped,
      EXT,
    );
    tree.setSessions(new Map([['s1', session('s1', { status: 'running' })]]));
    const nodes = [{ kind: 'session' as const, session: session('s1', { status: 'running' }) }];
    expect(tree.getTreeItem(nodes[0]!).id).toBe('session:s1');
  });

  it('never asks for the glyph that VSCode delegates to the icon theme', () => {
    // `folder` and `file` are treated apart: instead of drawing the codicon,
    // VSCode hands off to the file icon theme, which draws nothing when it
    // is set to "None". One editor would then show a folder, the other nothing.
    const tree = new SessionsTree(
      async () => true,
      async () => undefined,
      noopOnGroupsDropped,
      EXT,
    );
    const item = tree.getTreeItem({
      kind: 'group',
      group: { id: 'g1', name: 'Perso', order: 0, color: 'green' },
      sessions: [],
    });
    const icon = item.iconPath as { id: string };
    expect(['folder', 'file']).not.toContain(icon.id);
  });
});

// A greyed row a click is bringing back: the render loop settles it once the
// conversation is open again; meanwhile the row must show the wait and take
// no second click — a second click meant a second tab.
describe('SessionsTree — a row being brought back', () => {
  const checkHooksInstalled = vi.fn().mockResolvedValue(true);

  it('spins in place of its dot, says so, takes no click, and redraws only when the set moves', async () => {
    const tree = new SessionsTree(checkHooksInstalled, noopOnDrop, noopOnGroupsDropped, EXT);
    tree.setSessions(new Map([['a', session('a', { endedAt: 1 })], ['b', session('b', { endedAt: 1 })]]));
    let fired = 0;
    tree.onDidChangeTreeData(() => {
      fired += 1;
    });
    tree.setReopening(new Set(['a']));
    expect(fired).toBe(1);
    const [group] = await bodyOf(tree);
    const rows = await tree.getChildren(group);
    const items = rows.map((row) => tree.getTreeItem(row));
    const byId = new Map(rows.map((row, i) => [nodeId(row), items[i]!]));
    const a = byId.get('session:a')!;
    const b = byId.get('session:b')!;
    expect(a.iconPath).toMatchObject({ id: 'loading~spin' });
    expect(a.description).toBe('reopening…');
    expect(a.command).toBeUndefined();
    expect(b.iconPath).not.toMatchObject({ id: 'loading~spin' });
    expect(b.command?.command).toBe('kohVibe.focusSession');
    tree.setReopening(new Set(['a']));
    expect(fired).toBe(1);
    tree.setReopening(new Set());
    expect(fired).toBe(2);
  });
});

// The awake block and the asleep block, inside one folder. Closing a tab ends
// its conversation and the row stays, greyed (settings « persistent ») — but
// until now it sat flush against the live ones, and the eye had nothing to
// break on.
describe('a folder separates what is awake from what is asleep', () => {
  const make = (): SessionsTree => new SessionsTree(async () => true, noopOnDrop, noopOnGroupsDropped, EXT);

  const kindsUnder = async (t: SessionsTree): Promise<string[]> => {
    const [group] = await t.getChildren();
    return (await t.getChildren(group)).map((n) => n.kind);
  };

  it('slips one blank line between the open conversations and the greyed ones', async () => {
    const t = make();
    t.setSessions(
      new Map([
        ['a', session('a')],
        ['b', session('b', { endedAt: 10 })],
        ['c', session('c')],
        ['d', session('d', { endedAt: 20 })],
      ]),
    );
    expect(await kindsUnder(t)).toEqual(['session', 'session', 'spacer', 'session', 'session']);
  });

  it('breaks nothing when every conversation is awake — a single block has nothing to separate', async () => {
    const t = make();
    t.setSessions(new Map([['a', session('a')], ['c', session('c')]]));
    expect(await kindsUnder(t)).toEqual(['session', 'session']);
  });

  it('breaks nothing when every conversation is asleep, for the same reason', async () => {
    const t = make();
    t.setSessions(new Map([['a', session('a', { endedAt: 10 })], ['c', session('c', { endedAt: 20 })]]));
    expect(await kindsUnder(t)).toEqual(['session', 'session']);
  });

  // The bug this pair pins down: a folder arranged by hand ranked EVERY named
  // session ahead of the rest, asleep ones included, so putting one to sleep
  // greyed it where it stood and never moved it. The chosen order still has to
  // be honoured — but inside each block, not across the break.
  it('drops an asleep conversation into its block even in a folder arranged by hand', async () => {
    const t = make();
    t.setSessions(
      new Map([
        ['s1', session('s1')],
        ['s2', session('s2', { endedAt: 10 })],
        ['s3', session('s3')],
      ]),
    );
    t.setGroups(
      groups({
        groups: [{ id: 'g1', name: 'Dossier', order: 0 }],
        assignments: { s1: 'g1', s2: 'g1', s3: 'g1' },
        sessionOrder: { g1: ['s1', 's2', 's3'] },
      }),
    );
    const [group] = await t.getChildren();
    const rows = await t.getChildren(group);
    expect(rows.map((n) => (n.kind === 'session' ? n.session.id : n.kind))).toEqual(['s1', 's3', 'spacer', 's2']);
  });

  it('keeps the chosen order inside each block, awake and asleep alike', async () => {
    const t = make();
    t.setSessions(
      new Map([
        ['s1', session('s1', { endedAt: 10 })],
        ['s2', session('s2')],
        ['s3', session('s3', { endedAt: 20 })],
        ['s4', session('s4')],
      ]),
    );
    t.setGroups(
      groups({
        groups: [{ id: 'g1', name: 'Dossier', order: 0 }],
        assignments: { s1: 'g1', s2: 'g1', s3: 'g1', s4: 'g1' },
        sessionOrder: { g1: ['s4', 's3', 's2', 's1'] },
      }),
    );
    const [group] = await t.getChildren();
    const rows = await t.getChildren(group);
    // s4 then s2 among the awake, s3 then s1 among the asleep: the hand-picked
    // sequence survives inside each block.
    expect(rows.map((n) => (n.kind === 'session' ? n.session.id : n.kind))).toEqual([
      's4',
      's2',
      'spacer',
      's3',
      's1',
    ]);
  });

  it('gives each folder its own separator, which VSCode tells apart by id', async () => {
    const t = make();
    t.setSessions(new Map([['a', session('a')], ['b', session('b', { endedAt: 10 })]]));
    const [group] = await t.getChildren();
    const spacer = (await t.getChildren(group)).find((n) => n.kind === 'spacer');
    expect(spacer).toBeDefined();
    expect(nodeId(spacer!)).toContain('unfiled');
  });
});

// The context value is what a menu entry can see of a row. Three of them,
// because three rows offer three different gestures: the moon needs a tab to
// close, so it belongs to a live conversation started from an editor — and to
// no other.
describe('SessionsTree — a row says what can be done to it', () => {
  const make = (): SessionsTree => new SessionsTree(async () => true, noopOnDrop, noopOnGroupsDropped, EXT);

  const contextsUnder = async (t: SessionsTree): Promise<(string | undefined)[]> => {
    const [group] = await t.getChildren();
    return (await t.getChildren(group))
      .filter((n) => n.kind === 'session')
      .map((n) => t.getTreeItem(n).contextValue);
  };

  it('marks a greyed row apart, so the moon can stay off it', async () => {
    const t = make();
    t.setSessions(new Map([['a', session('a')], ['b', session('b', { endedAt: 10 })]]));
    expect(await contextsUnder(t)).toEqual(['session', 'sessionAsleep']);
  });

  it('marks a live conversation that has no tab apart too — nothing to put to sleep there', async () => {
    const t = make();
    t.setSessions(new Map([['a', session('a', { origin: 'terminal' })]]));
    expect(await contextsUnder(t)).toEqual(['sessionNoTab']);
  });

  it('keeps every one of them under the same prefix, so the shared menus still match', async () => {
    const t = make();
    t.setSessions(
      new Map([
        ['a', session('a')],
        ['b', session('b', { endedAt: 10 })],
        ['c', session('c', { origin: 'desktop' })],
      ]),
    );
    for (const value of await contextsUnder(t)) expect(value).toMatch(/^session/);
  });
});

// `TreeView.reveal` walks up with `getParent`, so selecting a row from the
// editor side needs it. `nodeFor` is the other half: the caller names a
// conversation, not a node shape.
describe('SessionsTree — reaching a row from outside', () => {
  const make = (): SessionsTree => new SessionsTree(async () => true, noopOnDrop, noopOnGroupsDropped, EXT);

  const filed = (): SessionsTree => {
    const t = make();
    t.setSessions(new Map([['s1', session('s1')], ['s2', session('s2')]]));
    t.setGroups(
      groups({ groups: [{ id: 'g1', name: 'Dossier', order: 0 }], assignments: { s1: 'g1' } }),
    );
    return t;
  };

  it('names the folder a conversation sits in', () => {
    const t = filed();
    const parent = t.getParent({ kind: 'session', session: session('s1') });
    expect(parent === undefined ? undefined : nodeId(parent)).toBe('group:g1');
  });

  it('names the unfiled bucket for a conversation in no folder', () => {
    const t = filed();
    const parent = t.getParent({ kind: 'session', session: session('s2') });
    expect(parent === undefined ? undefined : nodeId(parent)).toBe('group:unfiled');
  });

  it('hands back a folder carrying its real children, not an empty shell', async () => {
    const t = filed();
    const parent = t.getParent({ kind: 'session', session: session('s1') });
    expect(await t.getChildren(parent)).toHaveLength(1);
  });

  it('gives a folder no parent — it already sits at the root', () => {
    const t = filed();
    expect(t.getParent({ kind: 'group', group: undefined, sessions: [] })).toBeUndefined();
  });

  it('finds the node of a conversation it is showing, and only of one it shows', () => {
    const t = filed();
    const node = t.nodeFor('s1');
    expect(node === undefined ? undefined : nodeId(node)).toBe('session:s1');
    expect(t.nodeFor('nowhere')).toBeUndefined();
  });
});

// The visible chain of sleep, end to end: the sort, the break between the
// two blocks, and what the menus see of the row. Each link is tested in
// isolation higher up; this scenario chains them, because it is their
// chaining that the user watches, and no regression must leave an asleep
// row in the middle of the live ones.
describe('putting a conversation to sleep, seen from the view', () => {
  const make = (): SessionsTree => new SessionsTree(async () => true, noopOnDrop, noopOnGroupsDropped, EXT);

  const rowsOf = async (t: SessionsTree): Promise<string[]> => {
    const [group] = await t.getChildren();
    return (await t.getChildren(group)).map((n) => (n.kind === 'session' ? n.session.id : n.kind));
  };
  const menusOf = async (t: SessionsTree): Promise<(string | undefined)[]> => {
    const [group] = await t.getChildren();
    return (await t.getChildren(group))
      .filter((n) => n.kind === 'session')
      .map((n) => t.getTreeItem(n).contextValue);
  };

  it('moves the row below the break and takes its moon away, without touching the others', async () => {
    const t = make();
    t.setSessions(new Map([['a', session('a')], ['b', session('b')], ['c', session('c')]]));

    // Before: three live conversations, no break, three moons.
    expect(await rowsOf(t)).toEqual(['a', 'b', 'c']);
    expect(await menusOf(t)).toEqual(['session', 'session', 'session']);

    // The moon has done its job on « b »: it is marked ended.
    t.setSessions(new Map([['a', session('a')], ['b', session('b', { endedAt: 10 })], ['c', session('c')]]));

    expect(await rowsOf(t)).toEqual(['a', 'c', 'spacer', 'b']);
    // « b » no longer has a tab to close; « a » and « c » keep theirs.
    expect(await menusOf(t)).toEqual(['session', 'session', 'sessionAsleep']);
  });

  it('removes the break when the last asleep one wakes up', async () => {
    const t = make();
    t.setSessions(new Map([['a', session('a')], ['b', session('b', { endedAt: 10 })]]));
    expect(await rowsOf(t)).toEqual(['a', 'spacer', 'b']);

    t.setSessions(new Map([['a', session('a')], ['b', session('b')]]));
    expect(await rowsOf(t)).toEqual(['a', 'b']);
    expect(await menusOf(t)).toEqual(['session', 'session']);
  });
});

describe("SessionsTree — when animations are turned off", () => {
  const treeWith = (): SessionsTree => {
    const t = new SessionsTree(() => Promise.resolve(true), noopOnDrop, noopOnGroupsDropped, EXT);
    t.setSessions(new Map([['s1', session('s1', { status: 'running' })]]));
    t.setGroups(groups({}));
    return t;
  };
  const iconOf = (t: SessionsTree): string => {
    const item = t.getTreeItem({ kind: 'session', session: session('s1', { status: 'running' }) });
    return (item.iconPath as { dark: { fsPath: string } }).dark.fsPath;
  };

  it('animates as long as nobody has said anything — that is what ships', () => {
    expect(iconOf(treeWith())).not.toContain('still');
  });

  it('switches to the still icon set when the box is unchecked', () => {
    const t = treeWith();
    t.setAnimate(false);
    expect(iconOf(t)).toContain('still');
  });

  it('goes back to motion when it is checked again', () => {
    const t = treeWith();
    t.setAnimate(false);
    t.setAnimate(true);
    expect(iconOf(t)).not.toContain('still');
  });

  it('notifies VSCode of the change — without which the view would keep its old dots', () => {
    // `refresh` only signals what CHANGES ON SCREEN: the setting must
    // therefore be part of the signature, like the colour preview before it.
    const t = treeWith();
    const seen = vi.fn();
    t.onDidChangeTreeData(seen);
    t.setAnimate(false);
    expect(seen).toHaveBeenCalledTimes(1);
  });
});
