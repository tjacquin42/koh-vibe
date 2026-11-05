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
  reorderGroupsCommand,
  runGroupAction,
  soundGroupCommand,
  soundSessionCommand,
} from '../src/groups/commands';

// Counts the ACTUAL writes to disk (writeFile, called by updateGroups before every
// rename): the only way to prove that dropping several sessions fits in ONE SINGLE
// write, never one per session — same convention as test/groups-store.test.ts.
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

// The real wiring of Task 9: these functions are the only path between the
// tree (SessionsTree.onDrop) or the three folder commands (package.json) and
// the folder-layout file. Each one is exercised here directly, without vscode,
// on a disposable file — same convention as test/groups-store.test.ts and
// test/groups-store.test.ts: never the real ~/.koh-vibe.
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
  it('creates the folder when a name is provided', async () => {
    const out = await createGroupCommand(file, 'Perso', () => 'g1');

    expect(out?.groups).toEqual([{ id: 'g1', name: 'Perso', order: 0 }]);
    expect((await readGroups(file)).groups).toEqual([{ id: 'g1', name: 'Perso', order: 0 }]);
  });

  it("writes nothing when the name is undefined (input box cancelled)", async () => {
    const out = await createGroupCommand(file, undefined, () => 'g1');

    expect(out).toBeUndefined();
    expect((await readGroups(file)).groups).toEqual([]);
  });

  // The most important point of the task: the model throws on an empty name
  // (createGroup, groups/model.ts), and that throw must stay observable here
  // — it is runGroupAction, further below, that turns it into a message
  // rather than an unhandled call trace, never this function.
  it('throws when the name is empty rather than creating a nameless folder', async () => {
    await expect(createGroupCommand(file, '', () => 'g1')).rejects.toThrow(
      'A folder cannot have an empty name.',
    );
    expect((await readGroups(file)).groups).toEqual([]);
  });

  it('also throws when the name contains only whitespace', async () => {
    await expect(createGroupCommand(file, '   ', () => 'g1')).rejects.toThrow(
      'A folder cannot have an empty name.',
    );
  });
});

describe('renameGroupCommand', () => {
  it('renames the folder when a name is provided', async () => {
    await updateGroups(file, (s) => createGroup(s, 'ancien', () => 'g1'));

    const out = await renameGroupCommand(file, 'g1', 'nouveau');

    expect(out?.groups).toEqual([{ id: 'g1', name: 'nouveau', order: 0 }]);
  });

  it("writes nothing when the name is undefined (input box cancelled)", async () => {
    await updateGroups(file, (s) => createGroup(s, 'ancien', () => 'g1'));

    const out = await renameGroupCommand(file, 'g1', undefined);

    expect(out).toBeUndefined();
    expect((await readGroups(file)).groups).toEqual([{ id: 'g1', name: 'ancien', order: 0 }]);
  });

  it('throws when the name is empty rather than renaming to an empty name', async () => {
    await updateGroups(file, (s) => createGroup(s, 'ancien', () => 'g1'));

    await expect(renameGroupCommand(file, 'g1', '')).rejects.toThrow('A folder cannot have an empty name.');
    expect((await readGroups(file)).groups).toEqual([{ id: 'g1', name: 'ancien', order: 0 }]);
  });
});

describe('deleteGroupCommand', () => {
  it('deletes the folder and frees the sessions that were filed in it', async () => {
    await updateGroups(file, (s) => assign(createGroup(s, 'à supprimer', () => 'g1'), 's1', 'g1'));

    const out = await deleteGroupCommand(file, 'g1');

    expect(out.groups).toEqual([]);
    expect(out.assignments).toEqual({});
  });
});

describe('applyDrop', () => {
  it('assigns all dropped sessions to the targeted folder, in a single write', async () => {
    await updateGroups(file, (s) => createGroup(s, 'Taf', () => 'g1'));
    writeFileCalls.count = 0;

    const out = await applyDrop(file, ['s1', 's2', 's3'], 'g1', ['s1', 's2', 's3']);

    expect(out.assignments).toEqual({ s1: 'g1', s2: 'g1', s3: 'g1' });
    expect(writeFileCalls.count).toBe(1);
  });

  it('removes the assignment of sessions dropped on « Unfiled » (groupId undefined)', async () => {
    await updateGroups(file, (s) => assign(createGroup(s, 'Taf', () => 'g1'), 's1', 'g1'));

    const out = await applyDrop(file, ['s1'], undefined, ['s1']);

    expect(out.assignments).toEqual({});
  });

  it('silently ignores a nonexistent folder, like assign() (model.ts)', async () => {
    const out = await applyDrop(file, ['s1'], 'inconnu', ['s1']);

    expect(out.assignments).toEqual({});
  });
});

describe('runGroupAction', () => {
  it("never calls onError when the action succeeds", async () => {
    const onError = vi.fn();

    await runGroupAction(() => Promise.resolve('ok'), onError);

    expect(onError).not.toHaveBeenCalled();
  });

  // The central case of the task: an action that throws (an empty name,
  // among others) must never become an unhandled call trace. runGroupAction
  // is the only net — without it, the rejection would surface as-is all the
  // way up to the VSCode command handler.
  it('captures what the action throws and relays it as a message, without letting the rejection escape', async () => {
    const onError = vi.fn();

    await runGroupAction(() => Promise.reject(new Error('A folder cannot have an empty name.')), onError);

    expect(onError).toHaveBeenCalledWith('A folder cannot have an empty name.');
  });

  it('also relays a rejection that does not carry a real Error', async () => {
    const onError = vi.fn();

    await runGroupAction(() => Promise.reject('boom'), onError);

    expect(onError).toHaveBeenCalledWith('boom');
  });
});

describe('colorGroupCommand', () => {
  it('writes the color to the shared file, and reads it back', async () => {
    await updateGroups(file, (s) => createGroup(s, 'Perso', () => 'g-1'));
    await colorGroupCommand(file, 'g-1', 'orange');
    expect((await readGroups(file)).groups[0]?.color).toBe('orange');
  });

  it('removes the color without touching the rest of the folder layout', async () => {
    await updateGroups(file, (s) => assign(createGroup(s, 'Perso', () => 'g-1'), 'sess-1', 'g-1'));
    await colorGroupCommand(file, 'g-1', 'red');
    // Checked before removing: without this line, the test would pass just
    // as well if the color were never written at all.
    expect((await readGroups(file)).groups[0]?.color).toBe('red');
    await colorGroupCommand(file, 'g-1', undefined);
    const after = await readGroups(file);
    expect(after.groups[0]?.color).toBeUndefined();
    expect(after.groups[0]?.name).toBe('Perso');
    expect(after.assignments['sess-1']).toBe('g-1');
  });
});

describe('fileSessionCommand — « new session here »', () => {
  it('files the conversation into the folder, in one write', async () => {
    await updateGroups(file, (s) => createGroup(s, 'Perso', () => 'g1'));
    writeFileCalls.count = 0;
    const state = await fileSessionCommand(file, 's-new', 'g1');
    expect(state.assignments['s-new']).toBe('g1');
    expect((await readGroups(file)).assignments['s-new']).toBe('g1');
    expect(writeFileCalls.count).toBe(1);
  });

  it('files nothing into a folder that no longer exists, like a drop', async () => {
    const state = await fileSessionCommand(file, 's-new', 'nope');
    expect(state.assignments).not.toHaveProperty('s-new');
  });
});

describe('soundGroupCommand and soundSessionCommand', () => {
  it('sets the sound of a folder, and `undefined` gives it back to the global setting', async () => {
    await createGroupCommand(file, 'Perso', () => 'g1');
    await soundGroupCommand(file, 'g1', 'waiting', 'Funk');
    expect((await readGroups(file)).groups[0]?.soundWaiting).toBe('Funk');
    await soundGroupCommand(file, 'g1', 'waiting', undefined);
    expect((await readGroups(file)).groups[0]?.soundWaiting).toBeUndefined();
  });

  it('sets the sound of a conversation, and `undefined` gives it back to its folder', async () => {
    await soundSessionCommand(file, 's1', 'done', 'Hero');
    expect((await readGroups(file)).sessionSounds.done['s1']).toBe('Hero');
    await soundSessionCommand(file, 's1', 'done', undefined);
    expect((await readGroups(file)).sessionSounds.done['s1']).toBeUndefined();
  });
});

describe('reorderGroupsCommand', () => {
  it('moves folders in front of another, or to the end, in one write', async () => {
    await createGroupCommand(file, 'A', () => 'ga');
    await createGroupCommand(file, 'B', () => 'gb');
    await createGroupCommand(file, 'C', () => 'gc');
    writeFileCalls.count = 0;
    await reorderGroupsCommand(file, ['gc'], 'ga');
    expect((await readGroups(file)).groups.map((g) => g.id)).toEqual(['gc', 'ga', 'gb']);
    expect(writeFileCalls.count).toBe(1);
    await reorderGroupsCommand(file, ['gc'], undefined);
    expect((await readGroups(file)).groups.map((g) => g.id)).toEqual(['ga', 'gb', 'gc']);
  });
});
