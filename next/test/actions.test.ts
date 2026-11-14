import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { readGroups } from '../../src/groups/store';
import { readSettings } from '../../src/settings/store';
import { parseAction, type Action } from '../src/shared/actions';
import { runAction, V1_COMMANDS, type ActionDeps } from '../src/host/actions';
import { makeHome } from './home';

let home: string;
let calls: unknown[][];
let copied: string[];
let n: number;

function deps(over: Partial<ActionDeps> = {}): ActionDeps {
  return {
    groupsFile: join(home, 'groups.json'),
    settingsFile: join(home, 'settings.json'),
    newId: () => `new-${++n}`,
    hasCommand: async () => true,
    run: async (cmd, ...args) => {
      calls.push([cmd, ...args]);
    },
    copy: async (text) => {
      copied.push(text);
    },
    ...over,
  };
}

const run = (a: Action, over: Partial<ActionDeps> = {}) => runAction(a, deps(over));
const groups = () => readGroups(join(home, 'groups.json'));

beforeEach(async () => {
  home = await makeHome();
  calls = [];
  copied = [];
  n = 0;
});

describe('folders, written through V1 stores', () => {
  it('creates, renames, colors and deletes a folder', async () => {
    expect(await run({ kind: 'folder.create', name: 'Video' })).toEqual({ ok: true });
    expect((await groups()).groups.map((g) => g.name)).toEqual(['First', 'Second', 'Video']);
    await run({ kind: 'folder.rename', id: 'new-1', name: 'Videos' });
    await run({ kind: 'folder.color', id: 'new-1', color: 'pink' });
    expect((await groups()).groups.at(-1)).toMatchObject({ id: 'new-1', name: 'Videos', color: 'pink' });
    await run({ kind: 'folder.color', id: 'g1', color: null });
    expect((await groups()).groups[0]?.color).toBeUndefined();
    await run({ kind: 'folder.delete', id: 'g1' });
    const after = await groups();
    expect(after.groups.map((g) => g.id)).toEqual(['g2', 'new-1']);
    // Its conversations stay, out of any folder.
    expect(after.assignments['a']).toBeUndefined();
  });

  it('moves folders and files conversations in one write each', async () => {
    await run({ kind: 'folder.move', ids: ['g2'], before: 'g1' });
    expect((await groups()).groups.map((g) => g.id)).toEqual(['g2', 'g1']);
    await run({ kind: 'session.file', ids: ['c'], folder: 'g1', order: ['c', 'a', 'b'] });
    const s = await groups();
    expect(s.assignments['c']).toBe('g1');
    expect(s.sessionOrder['g1']).toEqual(['c', 'a', 'b']);
    await run({ kind: 'session.file', ids: ['c'], order: ['c'] });
    expect((await groups()).assignments['c']).toBeUndefined();
  });

  it('keeps what another window wrote meanwhile, like any V1 window', async () => {
    const file = join(home, 'groups.json');
    const raw = JSON.parse(await readFile(file, 'utf8')) as { groups: { id: string; name: string; order: number }[] };
    raw.groups.push({ id: 'other', name: 'From V1', order: 2 });
    await writeFile(file, JSON.stringify(raw));
    await run({ kind: 'folder.rename', id: 'g1', name: 'Renamed' });
    expect((await groups()).groups.map((g) => g.name)).toEqual(['Renamed', 'Second', 'From V1']);
  });
});

describe('settings, written through V1 store', () => {
  it('toggles and sets the volume in V1 units', async () => {
    await run({ kind: 'setting.toggle', key: 'animate', on: true });
    await run({ kind: 'setting.volume', percent: 75 });
    const s = await readSettings(join(home, 'settings.json'));
    expect(s.animate).toBe(true);
    expect(s.volume).toBe(0.75);
    // Untouched fields survive.
    expect(s.waiting).toBe('Glass');
  });
});

describe('what goes through V1 commands', () => {
  it('hands conversation actions to V1 with the node shape its menus pass', async () => {
    await run({ kind: 'session.command', command: 'sleep', id: 'a' });
    await run({ kind: 'session.command', command: 'close', id: 'a' });
    await run({ kind: 'session.new', folder: 'g1' });
    await run({ kind: 'session.new' });
    await run({ kind: 'setting.sound', event: 'done' });
    await run({ kind: 'folder.rules', id: 'g1', mode: 'add' });
    await run({ kind: 'folder.rules', id: 'g1', mode: 'open' });
    expect(calls).toEqual([
      [V1_COMMANDS.sleep, { kind: 'session', session: { id: 'a' } }],
      [V1_COMMANDS.close, { kind: 'session', session: { id: 'a' } }],
      ['kohVibe.newSessionInGroup', { kind: 'group', group: { id: 'g1' } }],
      ['kohVibe.newSession'],
      ['kohVibe.chooseSound', 'done'],
      ['kohVibe.addFolderRule', { kind: 'group', group: { id: 'g1' } }],
      ['kohVibe.openFolderRules', { kind: 'group', group: { id: 'g1' } }],
    ]);
  });

  it('says V1 is missing rather than doing it behind its back', async () => {
    expect(await run({ kind: 'session.command', command: 'sleep', id: 'a' }, { hasCommand: async () => false })).toEqual({ ok: false, error: 'v1-missing' });
    expect(calls).toEqual([]);
  });

  it('reports a command that throws', async () => {
    expect(await run({ kind: 'session.new' }, { run: async () => Promise.reject(new Error('x')) })).toEqual({ ok: false, error: 'failed' });
  });

  it('copies an id without V1', async () => {
    expect(await run({ kind: 'session.copyId', id: 'a' }, { hasCommand: async () => false })).toEqual({ ok: true });
    expect(copied).toEqual(['a']);
  });
});

describe('parseAction', () => {
  it('accepts well-formed actions and trims names', () => {
    expect(parseAction({ kind: 'folder.create', name: '  Video ' })).toEqual({ kind: 'folder.create', name: 'Video' });
    expect(parseAction({ kind: 'folder.color', id: 'g', color: null })).toEqual({ kind: 'folder.color', id: 'g', color: null });
    expect(parseAction({ kind: 'session.file', ids: ['a'], order: [] })).toEqual({ kind: 'session.file', ids: ['a'], order: [] });
    expect(parseAction({ kind: 'setting.volume', percent: 0 })).toEqual({ kind: 'setting.volume', percent: 0 });
  });

  it('drops anything malformed', () => {
    for (const bad of [
      null,
      { kind: 'rm' },
      { kind: 'folder.create', name: '   ' },
      { kind: 'folder.create', name: 'x'.repeat(81) },
      { kind: 'folder.rename', id: '../g', name: 'a' },
      { kind: 'folder.color', id: 'g', color: 'tomato' },
      { kind: 'folder.move', ids: [] },
      { kind: 'session.file', ids: ['a'] },
      { kind: 'session.command', command: 'kill', id: 'a' },
      { kind: 'session.command', command: 'forget', id: 'a' },
      { kind: 'setting.toggle', key: 'volume', on: true },
      { kind: 'setting.volume', percent: 101 },
      { kind: 'setting.volume', percent: 0.5 },
      { kind: 'setting.sound', event: 'start' },
    ]) {
      expect(parseAction(bad), JSON.stringify(bad)).toBeUndefined();
    }
  });
});
