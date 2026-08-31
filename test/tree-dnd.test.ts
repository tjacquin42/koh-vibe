import { describe, expect, it, vi } from 'vitest';
import { DataTransfer, DataTransferItem } from 'vscode';
import { SessionsTree } from '../src/ui/tree';
import type { TreeNode } from '../src/ui/tree';
import type { Session } from '../src/events/types';

// Le type MIME propre à cet arbre : c'est lui qui distingue « une donnée qui
// vient de nous » d'une donnée déposée par un autre arbre ou par l'OS. Répété
// ici en dur (plutôt qu'importé) parce que la valeur exacte fait partie du
// contrat public de la vue — un test qui l'importerait ne le vérifierait
// plus.
const MIME = 'application/vnd.code.tree.kohvibe.sessions';
// The folders' own type, for the same reason: the exact value is part of the
// view's public contract, so it is written out here rather than imported.
const GROUP_MIME = 'application/vnd.code.tree.kohvibe.groups';

// La racine du paquet, dont la vue tire ses pastilles de statut. Un chemin
// fictif suffit ici : ce qui est vérifié, c'est la FORME de l'iconPath, pas le
// contenu des fichiers — test/status-icon.test.ts s'assure, lui, qu'ils existent.
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

// onDrop est obligatoire au constructeur (un câblage oublié doit échouer à la
// compilation, pas produire un glisser-déposer inerte à l'exécution) : ce
// bouchon partagé sert aux tests qui ne portent pas sur son appel lui-même.
const noopOnDrop = async (): Promise<void> => undefined;
const noopOnGroupsDropped = async (): Promise<void> => undefined;

describe('SessionsTree — handleDrop (the decision, not the VSCode mechanism)', () => {
  it('assigns a session dropped on a folder', async () => {
    const onDrop = vi.fn().mockResolvedValue(undefined);
    const tree = new SessionsTree(() => Promise.resolve(true), onDrop, noopOnGroupsDropped, EXT);

    await tree.handleDrop(groupNode('g-perso', 'Perso'), dataWith(['s1']));

    expect(onDrop).toHaveBeenCalledTimes(1);
    expect(onDrop).toHaveBeenCalledWith(['s1'], 'g-perso', ['s1']);
  });

  it('assigns several sessions dropped at once on a folder', async () => {
    const onDrop = vi.fn().mockResolvedValue(undefined);
    const tree = new SessionsTree(() => Promise.resolve(true), onDrop, noopOnGroupsDropped, EXT);

    await tree.handleDrop(groupNode('g-taf', 'Taf'), dataWith(['s1', 's2', 's3']));

    expect(onDrop).toHaveBeenCalledWith(['s1', 's2', 's3'], 'g-taf', ['s1', 's2', 's3']);
  });

  it('clears the assignment when dropping on "Unfiled"', async () => {
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

  it('filters out non-string entries rather than casting them, and ignores what is left of nothing', async () => {
    const onDrop = vi.fn().mockResolvedValue(undefined);
    const tree = new SessionsTree(() => Promise.resolve(true), onDrop, noopOnGroupsDropped, EXT);

    await tree.handleDrop(groupNode('g1', 'Dossier'), dataWith(['s1', 42, null, 's2']));

    expect(onDrop).toHaveBeenCalledWith(['s1', 's2'], 'g1', ['s1', 's2']);
  });

  it('changes nothing when the carried array holds no usable string', async () => {
    const onDrop = vi.fn().mockResolvedValue(undefined);
    const tree = new SessionsTree(() => Promise.resolve(true), onDrop, noopOnGroupsDropped, EXT);

    await tree.handleDrop(groupNode('g1', 'Dossier'), dataWith([42, null]));

    expect(onDrop).not.toHaveBeenCalled();
  });

  // Une session est désormais une cible : on se place DEVANT elle. Le piège
  // reste le même qu'avant — `target.group` n'existe pas sur un nœud de
  // session, et le lire vaudrait `undefined`, donc « Sans dossier ». Le dossier
  // doit être celui de la session survolée, jamais celui du nœud déposé.
  it('drops ahead of the hovered session, into THAT session folder', async () => {
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

    // Le dossier est bien g1 — et surtout PAS undefined, qui aurait sorti la
    // session de son dossier en croyant la réordonner.
    expect(onDrop).toHaveBeenCalledWith(['s3'], 'g1', ['s1', 's3', 's2']);
  });

  it('dropping a session on itself does not make it vanish', async () => {
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

  it('ignores a drop on the empty-state node, for the same reason', async () => {
    const onDrop = vi.fn().mockResolvedValue(undefined);
    const tree = new SessionsTree(() => Promise.resolve(true), onDrop, noopOnGroupsDropped, EXT);

    await tree.handleDrop({ kind: 'empty', message: 'Aucune session Claude Code active' }, dataWith(['s1']));

    expect(onDrop).not.toHaveBeenCalled();
  });

  it('a drop on the folder the session is already in behaves no differently from an ordinary assignment', async () => {
    const onDrop = vi.fn().mockResolvedValue(undefined);
    const tree = new SessionsTree(() => Promise.resolve(true), onDrop, noopOnGroupsDropped, EXT);
    const target: TreeNode = { kind: 'group', group: { id: 'g1', name: 'Dossier', order: 0 }, sessions: [session('s1')] };

    await tree.handleDrop(target, dataWith(['s1']));

    // Ni court-circuité (rien ne se passerait), ni doublé (une désaffectation
    // suivie d'une réaffectation) : le même appel unique qu'un dépôt sur
    // n'importe quel autre dossier — l'idempotence est la charge d'`onDrop`
    // (Task 9), pas celle de la vue.
    expect(onDrop).toHaveBeenCalledTimes(1);
    expect(onDrop).toHaveBeenCalledWith(['s1'], 'g1', ['s1']);
  });
});

describe('SessionsTree — handleDrag (what leaves in the transfer)', () => {
  it('puts the selected session ids under our MIME type', () => {
    const tree = new SessionsTree(() => Promise.resolve(true), noopOnDrop, noopOnGroupsDropped, EXT);
    const data = new DataTransfer();

    tree.handleDrag([sessionNode('s1'), sessionNode('s2')], data);

    expect(data.get(MIME)?.value).toEqual(['s1', 's2']);
  });

  it('ignores nodes that are not sessions (a folder selected alongside sessions)', () => {
    const tree = new SessionsTree(() => Promise.resolve(true), noopOnDrop, noopOnGroupsDropped, EXT);
    const data = new DataTransfer();

    tree.handleDrag([groupNode('g1', 'Dossier'), sessionNode('s1')], data);

    expect(data.get(MIME)?.value).toEqual(['s1']);
  });

  it('puts nothing in the transfer when no session is selected', () => {
    const tree = new SessionsTree(() => Promise.resolve(true), noopOnDrop, noopOnGroupsDropped, EXT);
    const data = new DataTransfer();

    tree.handleDrag([groupNode('g1', 'Dossier')], data);

    expect(data.get(MIME)).toBeUndefined();
  });
});

describe('SessionsTree — the MIME types it announces', () => {
  it('announces its own MIME type only, for drag as for drop', () => {
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
