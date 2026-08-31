import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { assign, createGroup } from '../src/groups/model';
import { readGroups, updateGroups } from '../src/groups/store';
import {
  applyDrop,
  colorGroupCommand,
  createGroupCommand,
  deleteGroupCommand,
  fileSessionCommand,
  renameGroupCommand,
  runGroupAction,
} from '../src/groups/commands';

// Compte les écritures RÉELLES sur disque (writeFile, appelé par updateGroups avant chaque
// rename) : seul moyen de prouver qu'un dépôt de plusieurs sessions tient dans UNE SEULE
// écriture, jamais une par session — même convention que test/groups-store.test.ts.
const { writeFileCalls } = vi.hoisted(() => ({ writeFileCalls: { count: 0 } }));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    writeFile: (...args: Parameters<typeof actual.writeFile>) => {
      writeFileCalls.count += 1;
      return actual.writeFile(...args);
    },
  };
});

// Câblage réel de Task 9 : ces fonctions sont le seul chemin entre l'arbre
// (SessionsTree.onDrop) ou les trois commandes de dossier (package.json) et
// le fichier de classement. Chacune est ici exercée directement, sans vscode,
// sur un fichier jetable — même convention que test/groups-store.test.ts et
// test/groups-store.test.ts : jamais le ~/.koh-vibe réel.
let dir: string;
let file: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'koh-groups-commands-'));
  file = join(dir, 'groups.json');
  writeFileCalls.count = 0;
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('createGroupCommand', () => {
  it('creates the folder when a name is given', async () => {
    const out = await createGroupCommand(file, 'Perso', () => 'g1');

    expect(out?.groups).toEqual([{ id: 'g1', name: 'Perso', order: 0 }]);
    expect((await readGroups(file)).groups).toEqual([{ id: 'g1', name: 'Perso', order: 0 }]);
  });

  it('writes nothing when the name is undefined (input box cancelled)', async () => {
    const out = await createGroupCommand(file, undefined, () => 'g1');

    expect(out).toBeUndefined();
    expect((await readGroups(file)).groups).toEqual([]);
  });

  // Le point le plus important de la tâche : le modèle lève sur un nom vide
  // (createGroup, groups/model.ts), et cette levée doit rester observable ici
  // — c'est runGroupAction, plus bas, qui la transforme en message plutôt
  // qu'en trace d'appel non gérée, jamais cette fonction-ci.
  it('throws on an empty name rather than creating a nameless folder', async () => {
    await expect(createGroupCommand(file, '', () => 'g1')).rejects.toThrow(
      'A folder cannot have an empty name.',
    );
    expect((await readGroups(file)).groups).toEqual([]);
  });

  it('throws on a name made of blanks too', async () => {
    await expect(createGroupCommand(file, '   ', () => 'g1')).rejects.toThrow(
      'A folder cannot have an empty name.',
    );
  });
});

describe('renameGroupCommand', () => {
  it('renames the folder when a name is given', async () => {
    await updateGroups(file, (s) => createGroup(s, 'ancien', () => 'g1'));

    const out = await renameGroupCommand(file, 'g1', 'nouveau');

    expect(out?.groups).toEqual([{ id: 'g1', name: 'nouveau', order: 0 }]);
  });

  it('writes nothing when the name is undefined (input box cancelled)', async () => {
    await updateGroups(file, (s) => createGroup(s, 'ancien', () => 'g1'));

    const out = await renameGroupCommand(file, 'g1', undefined);

    expect(out).toBeUndefined();
    expect((await readGroups(file)).groups).toEqual([{ id: 'g1', name: 'ancien', order: 0 }]);
  });

  it('throws on an empty name rather than renaming to nothing', async () => {
    await updateGroups(file, (s) => createGroup(s, 'ancien', () => 'g1'));

    await expect(renameGroupCommand(file, 'g1', '')).rejects.toThrow('A folder cannot have an empty name.');
    expect((await readGroups(file)).groups).toEqual([{ id: 'g1', name: 'ancien', order: 0 }]);
  });
});

describe('deleteGroupCommand', () => {
  it('deletes the folder and frees the sessions filed in it', async () => {
    await updateGroups(file, (s) => assign(createGroup(s, 'à supprimer', () => 'g1'), 's1', 'g1'));

    const out = await deleteGroupCommand(file, 'g1');

    expect(out.groups).toEqual([]);
    expect(out.assignments).toEqual({});
  });
});

describe('applyDrop', () => {
  it('assigns every dropped session to the target folder, in a single write', async () => {
    await updateGroups(file, (s) => createGroup(s, 'Taf', () => 'g1'));
    writeFileCalls.count = 0;

    const out = await applyDrop(file, ['s1', 's2', 's3'], 'g1', ['s1', 's2', 's3']);

    expect(out.assignments).toEqual({ s1: 'g1', s2: 'g1', s3: 'g1' });
    expect(writeFileCalls.count).toBe(1);
  });

  it('clears the assignment of sessions dropped on "Unfiled" (groupId undefined)', async () => {
    await updateGroups(file, (s) => assign(createGroup(s, 'Taf', () => 'g1'), 's1', 'g1'));

    const out = await applyDrop(file, ['s1'], undefined, ['s1']);

    expect(out.assignments).toEqual({});
  });

  it('silently ignores a folder that does not exist, like assign() does (model.ts)', async () => {
    const out = await applyDrop(file, ['s1'], 'inconnu', ['s1']);

    expect(out.assignments).toEqual({});
  });
});

describe('runGroupAction', () => {
  it('never calls onError when the action succeeds', async () => {
    const onError = vi.fn();

    await runGroupAction(() => Promise.resolve('ok'), onError);

    expect(onError).not.toHaveBeenCalled();
  });

  // Le cas central de la tâche : une action qui lève (nom vide, entre autres)
  // ne doit jamais devenir une trace d'appel non gérée. runGroupAction est le
  // seul filet — sans lui, le rejet remonterait tel quel jusqu'au gestionnaire
  // de commande VSCode.
  it('catches what the action throws and relays it as a message, letting no rejection escape', async () => {
    const onError = vi.fn();

    await runGroupAction(() => Promise.reject(new Error('A folder cannot have an empty name.')), onError);

    expect(onError).toHaveBeenCalledWith('A folder cannot have an empty name.');
  });

  it('relays a rejection that carries no real Error too', async () => {
    const onError = vi.fn();

    await runGroupAction(() => Promise.reject('boom'), onError);

    expect(onError).toHaveBeenCalledWith('boom');
  });
});

describe('colorGroupCommand', () => {
  it('writes the colour into the shared file, and reads it back', async () => {
    await updateGroups(file, (s) => createGroup(s, 'Perso', () => 'g-1'));
    await colorGroupCommand(file, 'g-1', 'orange');
    expect((await readGroups(file)).groups[0]?.color).toBe('orange');
  });

  it('removes the colour without touching the rest of the filing', async () => {
    await updateGroups(file, (s) => assign(createGroup(s, 'Perso', () => 'g-1'), 'sess-1', 'g-1'));
    await colorGroupCommand(file, 'g-1', 'red');
    // Vérifié avant de retirer : sans cette ligne, le test passerait tout aussi
    // bien si la couleur n'était jamais écrite.
    expect((await readGroups(file)).groups[0]?.color).toBe('red');
    await colorGroupCommand(file, 'g-1', undefined);
    const after = await readGroups(file);
    expect(after.groups[0]?.color).toBeUndefined();
    expect(after.groups[0]?.name).toBe('Perso');
    expect(after.assignments['sess-1']).toBe('g-1');
  });
});

describe('fileSessionCommand — "new session here"', () => {
  it('files the conversation into the folder, in one write', async () => {
    await updateGroups(file, (s) => createGroup(s, 'Perso', () => 'g1'));
    writeFileCalls.count = 0;
    const state = await fileSessionCommand(file, 's-new', 'g1');
    expect(state.assignments['s-new']).toBe('g1');
    expect((await readGroups(file)).assignments['s-new']).toBe('g1');
    expect(writeFileCalls.count).toBe(1);
  });

  it('files nothing into a folder that is gone, like a drop does', async () => {
    const state = await fileSessionCommand(file, 's-new', 'nope');
    expect(state.assignments).not.toHaveProperty('s-new');
  });
});
