import { describe, expect, it, vi } from 'vitest';
import { DataTransfer, DataTransferItem } from 'vscode';
import { SessionsTree } from '../src/ui/tree';
import type { TreeNode } from '../src/ui/tree';
import type { Session } from '../src/events/types';

// The MIME type specific to this tree: it is what distinguishes « data that
// comes from us » from data dropped by another tree or by the OS. Repeated
// here verbatim (rather than imported) because the exact value is part of
// the view's public contract — a test that imported it would no longer be
// checking it.
const MIME = 'application/vnd.code.tree.kohvibe.sessions';
// The folders' own type, for the same reason: the exact value is part of the
// view's public contract, so it is written out here rather than imported.
const GROUP_MIME = 'application/vnd.code.tree.kohvibe.groups';

// The extension root, from which the view draws its status dots. A fake path
// is enough here: what is checked is the SHAPE of the iconPath, not the
// files' actual content — test/status-icon.test.ts is the one that makes
// sure they exist.
const EXT = '/ext';

const session = (id: string): Session => ({
  id,
  cwd: '/Users/dev/projet',
  project: 'projet',
  origin: 'vscode',
  status: 'idle',
  toolCount: 0,
  lastEventAt: 0,
});

const sessionNode = (id: string): TreeNode => ({ kind: 'session', session: session(id) });
const groupNode = (id: string, name: string): TreeNode => ({
  kind: 'group',
  group: { id, name, order: 0 },
  sessions: [],
});
const unfiledNode = (): TreeNode => ({ kind: 'group', group: undefined, sessions: [] });

const dataWith = (ids: unknown): DataTransfer => {
  const data = new DataTransfer();
  data.set(MIME, new DataTransferItem(ids));
  return data;
};

const groupDataWith = (ids: unknown): DataTransfer => {
  const data = new DataTransfer();
  data.set(GROUP_MIME, new DataTransferItem(ids));
  return data;
};

// onDrop is mandatory in the constructor (a forgotten wiring must fail at
// compile time, not produce an inert drag-and-drop at runtime): this shared
// stub serves the tests that are not about its own call.
const noopOnDrop = async (): Promise<void> => undefined;
const noopOnGroupsDropped = async (): Promise<void> => undefined;

describe('SessionsTree — handleDrop (the decision, not the VSCode mechanics)', () => {
  it('files a session dropped on a folder', async () => {
    const onDrop = vi.fn().mockResolvedValue(undefined);
    const tree = new SessionsTree(() => Promise.resolve(true), onDrop, noopOnGroupsDropped, EXT);

    await tree.handleDrop(groupNode('g-perso', 'Perso'), dataWith(['s1']));

    expect(onDrop).toHaveBeenCalledTimes(1);
    expect(onDrop).toHaveBeenCalledWith(['s1'], 'g-perso', ['s1']);
  });

  it('files several sessions dropped at once on a folder', async () => {
    const onDrop = vi.fn().mockResolvedValue(undefined);
    const tree = new SessionsTree(() => Promise.resolve(true), onDrop, noopOnGroupsDropped, EXT);

    await tree.handleDrop(groupNode('g-taf', 'Taf'), dataWith(['s1', 's2', 's3']));

    expect(onDrop).toHaveBeenCalledWith(['s1', 's2', 's3'], 'g-taf', ['s1', 's2', 's3']);
  });

  it('removes the assignment when dropping on « Unfiled »', async () => {
    const onDrop = vi.fn().mockResolvedValue(undefined);
    const tree = new SessionsTree(() => Promise.resolve(true), onDrop, noopOnGroupsDropped, EXT);

    await tree.handleDrop(unfiledNode(), dataWith(['s1']));

    expect(onDrop).toHaveBeenCalledWith(['s1'], undefined, ['s1']);
  });

  it('changes nothing when dropping on the empty part of the view (no target)', async () => {
    const onDrop = vi.fn().mockResolvedValue(undefined);
    const tree = new SessionsTree(() => Promise.resolve(true), onDrop, noopOnGroupsDropped, EXT);

    await tree.handleDrop(undefined, dataWith(['s1']));

    expect(onDrop).not.toHaveBeenCalled();
  });

  it('changes nothing when the dropped data does not carry our MIME type', async () => {
    const onDrop = vi.fn().mockResolvedValue(undefined);
    const tree = new SessionsTree(() => Promise.resolve(true), onDrop, noopOnGroupsDropped, EXT);
    const data = new DataTransfer();
    data.set('text/plain', new DataTransferItem('un texte quelconque'));

    await tree.handleDrop(groupNode('g1', 'Dossier'), data);

    expect(onDrop).not.toHaveBeenCalled();
  });

  it('changes nothing when the carried value is not an array', async () => {
    const onDrop = vi.fn().mockResolvedValue(undefined);
    const tree = new SessionsTree(() => Promise.resolve(true), onDrop, noopOnGroupsDropped, EXT);

    await tree.handleDrop(groupNode('g1', 'Dossier'), dataWith('s1'));

    expect(onDrop).not.toHaveBeenCalled();
  });

  it('filters out non-string entries rather than casting them, and discards whatever does not survive the filter', async () => {
    const onDrop = vi.fn().mockResolvedValue(undefined);
    const tree = new SessionsTree(() => Promise.resolve(true), onDrop, noopOnGroupsDropped, EXT);

    await tree.handleDrop(groupNode('g1', 'Dossier'), dataWith(['s1', 42, null, 's2']));

    expect(onDrop).toHaveBeenCalledWith(['s1', 's2'], 'g1', ['s1', 's2']);
  });

  it('changes nothing when the carried array contains no usable string', async () => {
    const onDrop = vi.fn().mockResolvedValue(undefined);
    const tree = new SessionsTree(() => Promise.resolve(true), onDrop, noopOnGroupsDropped, EXT);

    await tree.handleDrop(groupNode('g1', 'Dossier'), dataWith([42, null]));

    expect(onDrop).not.toHaveBeenCalled();
  });

  // A session is now a target too: we place ourselves IN FRONT of it. The
  // trap stays the same as before — `target.group` does not exist on a
  // session node, and reading it would yield `undefined`, hence « Unfiled ».
  // The folder must be that of the hovered session, never that of the
  // dropped node.
  it('drops in front of the hovered session, into the folder of THAT session', async () => {
    const onDrop = vi.fn().mockResolvedValue(undefined);
    const tree = new SessionsTree(() => Promise.resolve(true), onDrop, noopOnGroupsDropped, EXT);
    tree.setSessions(new Map([['s1', session('s1')], ['s2', session('s2')], ['s3', session('s3')]]));
    tree.setGroups({
      groups: [{ id: 'g1', name: 'Dossier', order: 0 }],
      assignments: { s1: 'g1', s2: 'g1', s3: 'g1' },
      sessionOrder: { g1: ['s1', 's2', 's3'] },
      sessionSounds: { waiting: {}, done: {} },
      unknown: {},
    });

    await tree.handleDrop(sessionNode('s2'), dataWith(['s3']));

    // The folder is indeed g1 — and above all NOT undefined, which would
    // have taken the session out of its folder while believing it was just
    // reordering it.
    expect(onDrop).toHaveBeenCalledWith(['s3'], 'g1', ['s1', 's3', 's2']);
  });

  it('dropping a session on itself does not make it disappear', async () => {
    const onDrop = vi.fn().mockResolvedValue(undefined);
    const tree = new SessionsTree(() => Promise.resolve(true), onDrop, noopOnGroupsDropped, EXT);
    tree.setSessions(new Map([['s1', session('s1')], ['s2', session('s2')]]));
    tree.setGroups({
      groups: [{ id: 'g1', name: 'Dossier', order: 0 }],
      assignments: { s1: 'g1', s2: 'g1' },
      sessionOrder: { g1: ['s1', 's2'] },
      sessionSounds: { waiting: {}, done: {} },
      unknown: {},
    });

    await tree.handleDrop(sessionNode('s1'), dataWith(['s1']));

    expect(onDrop).toHaveBeenCalledWith(['s1'], 'g1', ['s1', 's2']);
  });

  it("ignores a drop on the empty-state node, for the same reason", async () => {
    const onDrop = vi.fn().mockResolvedValue(undefined);
    const tree = new SessionsTree(() => Promise.resolve(true), onDrop, noopOnGroupsDropped, EXT);

    await tree.handleDrop({ kind: 'empty', message: 'Aucune session Claude Code active' }, dataWith(['s1']));

    expect(onDrop).not.toHaveBeenCalled();
  });

  it("a drop on the folder where the session is already filed has no different effect than a normal assignment", async () => {
    const onDrop = vi.fn().mockResolvedValue(undefined);
    const tree = new SessionsTree(() => Promise.resolve(true), onDrop, noopOnGroupsDropped, EXT);
    const target: TreeNode = { kind: 'group', group: { id: 'g1', name: 'Dossier', order: 0 }, sessions: [session('s1')] };

    await tree.handleDrop(target, dataWith(['s1']));

    // Neither short-circuited (nothing would happen), nor doubled (an
    // unassignment followed by a reassignment): the same single call as a
    // drop on any other folder — idempotence is `onDrop`'s job (Task 9),
    // not the view's.
    expect(onDrop).toHaveBeenCalledTimes(1);
    expect(onDrop).toHaveBeenCalledWith(['s1'], 'g1', ['s1']);
  });
});

describe('SessionsTree — handleDrag (what goes into the transfer)', () => {
  it('places the ids of the selected sessions under our MIME type', () => {
    const tree = new SessionsTree(() => Promise.resolve(true), noopOnDrop, noopOnGroupsDropped, EXT);
    const data = new DataTransfer();

    tree.handleDrag([sessionNode('s1'), sessionNode('s2')], data);

    expect(data.get(MIME)?.value).toEqual(['s1', 's2']);
  });

  it('ignores nodes that are not sessions (a folder selected together with sessions)', () => {
    const tree = new SessionsTree(() => Promise.resolve(true), noopOnDrop, noopOnGroupsDropped, EXT);
    const data = new DataTransfer();

    tree.handleDrag([groupNode('g1', 'Dossier'), sessionNode('s1')], data);

    expect(data.get(MIME)?.value).toEqual(['s1']);
  });

  it('puts nothing into the transfer when no session is selected', () => {
    const tree = new SessionsTree(() => Promise.resolve(true), noopOnDrop, noopOnGroupsDropped, EXT);
    const data = new DataTransfer();

    tree.handleDrag([groupNode('g1', 'Dossier')], data);

    expect(data.get(MIME)).toBeUndefined();
  });
});

describe('SessionsTree — advertised MIME types', () => {
  it("advertises only its own MIME type, both dragging and dropping", () => {
    const tree = new SessionsTree(() => Promise.resolve(true), noopOnDrop, noopOnGroupsDropped, EXT);

    expect(tree.dropMimeTypes).toEqual([MIME, GROUP_MIME]);
    expect(tree.dragMimeTypes).toEqual([MIME, GROUP_MIME]);
  });
});

describe('SessionsTree — moving the folders themselves', () => {
  const make = (onGroups: ReturnType<typeof vi.fn>): SessionsTree =>
    new SessionsTree(() => Promise.resolve(true), noopOnDrop, onGroups, EXT);

  it('publishes the dragged folders under their own type, apart from the sessions', () => {
    const tree = new SessionsTree(() => Promise.resolve(true), noopOnDrop, noopOnGroupsDropped, EXT);
    const data = new DataTransfer();

    tree.handleDrag([groupNode('g1', 'Perso'), sessionNode('s1')], data);

    expect(data.get(GROUP_MIME)?.value).toEqual(['g1']);
    expect(data.get(MIME)?.value).toEqual(['s1']);
  });

  it('never publishes « Unfiled »: it has no id, so there is nothing to move', () => {
    const tree = new SessionsTree(() => Promise.resolve(true), noopOnDrop, noopOnGroupsDropped, EXT);
    const data = new DataTransfer();

    tree.handleDrag([unfiledNode()], data);

    expect(data.get(GROUP_MIME)).toBeUndefined();
  });

  it('moves a folder in front of the one it was dropped on', async () => {
    const onGroups = vi.fn().mockResolvedValue(undefined);
    await make(onGroups).handleDrop(groupNode('g-work', 'Work'), groupDataWith(['g-perso']));

    expect(onGroups).toHaveBeenCalledWith(['g-perso'], 'g-work');
  });

  it('reads « Unfiled » as the end of the list, since it has no id and always sits last', async () => {
    const onGroups = vi.fn().mockResolvedValue(undefined);
    await make(onGroups).handleDrop(unfiledNode(), groupDataWith(['g-perso']));

    expect(onGroups).toHaveBeenCalledWith(['g-perso'], undefined);
  });

  it('does nothing when a folder is dropped on a session — that names no position among the folders', async () => {
    const onGroups = vi.fn().mockResolvedValue(undefined);
    await make(onGroups).handleDrop(sessionNode('s1'), groupDataWith(['g-perso']));

    expect(onGroups).not.toHaveBeenCalled();
  });

  it('does nothing when a folder is dropped on nothing at all', async () => {
    const onGroups = vi.fn().mockResolvedValue(undefined);
    await make(onGroups).handleDrop(undefined, groupDataWith(['g-perso']));

    expect(onGroups).not.toHaveBeenCalled();
  });

  it('resolves a mixed drag by what it was dropped ON: onto a folder, the folders move', async () => {
    const onDrop = vi.fn().mockResolvedValue(undefined);
    const onGroups = vi.fn().mockResolvedValue(undefined);
    const data = groupDataWith(['g-perso']);
    data.set(MIME, new DataTransferItem(['s1']));

    const tree = new SessionsTree(() => Promise.resolve(true), onDrop, onGroups, EXT);
    await tree.handleDrop(groupNode('g-work', 'Work'), data);

    expect(onGroups).toHaveBeenCalledWith(['g-perso'], 'g-work');
    // and the sessions of that same drag are NOT filed at the same time: one
    // gesture, one meaning.
    expect(onDrop).not.toHaveBeenCalled();
  });

  it('files the sessions of a mixed drag when it lands on a session, rather than swallowing the whole drop', async () => {
    const onDrop = vi.fn().mockResolvedValue(undefined);
    const onGroups = vi.fn().mockResolvedValue(undefined);
    const data = groupDataWith(['g-perso']);
    data.set(MIME, new DataTransferItem(['s1']));

    const tree = new SessionsTree(() => Promise.resolve(true), onDrop, onGroups, EXT);
    tree.setSessions(new Map([['s2', session('s2')]]));
    await tree.handleDrop(sessionNode('s2'), data);

    expect(onGroups).not.toHaveBeenCalled();
    expect(onDrop).toHaveBeenCalledTimes(1);
  });

  it('ignores anything that is not a list of strings, like the session path does', async () => {
    const onGroups = vi.fn().mockResolvedValue(undefined);
    const tree = make(onGroups);

    await tree.handleDrop(groupNode('g-work', 'Work'), groupDataWith('g-perso'));
    await tree.handleDrop(groupNode('g-work', 'Work'), groupDataWith([42, null]));

    expect(onGroups).not.toHaveBeenCalled();
  });
});
