import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { readGroups } from '../../src/groups/store';
import { readSettings } from '../../src/settings/store';
import { parseAction, type Action } from '../src/shared/actions';
import { runAction, V1_COMMANDS, type ActionDeps } from '../src/host/actions';
import { readArtifactProjects } from '../../src/artifacts/projects-store';
import type { SessionProcess } from '../../src/process/classify';
import type { Routine } from '../../src/routines/model';
import type { CloudActions } from '../src/host/cloud';
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
    artifactProjectsFile: join(home, 'artifact-projects.json'),
    open: (url) => calls.push(['open', url]),
    cloud: fakeCloud(),
    locate: async (pid) => (pid === proc.pid ? { proc, among: [proc, child] } : undefined),
    confirmKill: async () => true,
    kill: (targets) => {
      killed.push(...targets.map((t) => t.pid));
      return targets.length;
    },
    setEditorTabs: async (mode) => {
      calls.push(['editorTabs', mode]);
    },
    setLanguage: async (choice) => {
      calls.push(['language', choice]);
    },
    ...over,
  };
}

const proc: SessionProcess = { pid: 400, ppid: 1, elapsed: 60, rss: 1_000, command: 'node vite --port 5173', depth: 1, label: 'vite', kind: 'work' };
const child: SessionProcess = { pid: 401, ppid: 400, elapsed: 60, rss: 1_000, command: 'esbuild --service', depth: 2, label: 'esbuild', kind: 'work' };
let killed: number[];
let cloudLog: string[];
let routine: Routine | undefined;

function fakeCloud(over: Partial<CloudActions> = {}): CloudActions {
  const log = (line: string, ok = true) => {
    cloudLog.push(line);
    return Promise.resolve(ok);
  };
  return {
    renameArtifact: (slug, title) => log(`rename ${slug} ${title}`),
    pinArtifact: (slug, pinned) => log(`pin ${slug} ${pinned}`),
    deleteArtifact: (slug) => log(`delete ${slug}`),
    runRoutine: (id) => log(`run ${id}`),
    setRoutineEnabled: (id, enabled) => log(`enabled ${id} ${enabled}`),
    routine: async () => routine,
    refresh: async (what, force) => {
      cloudLog.push(`refresh ${what} ${force}`);
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
  killed = [];
  cloudLog = [];
  routine = { id: 'r1', name: 'Daily', enabled: true, fired: false, cron: '0 7 * * *', repos: [] };
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
    await run({ kind: 'folder.rules', id: 'g1', mode: 'add' });
    await run({ kind: 'folder.rules', id: 'g1', mode: 'open' });
    expect(calls).toEqual([
      [V1_COMMANDS.sleep, { kind: 'session', session: { id: 'a' } }],
      [V1_COMMANDS.close, { kind: 'session', session: { id: 'a' } }],
      ['kohVibe.newSessionInGroup', { kind: 'group', group: { id: 'g1' } }],
      ['kohVibe.newSession'],
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

describe('claude.ai, through V1 API functions', () => {
  it('renames, pins and deletes, then reads the list again', async () => {
    await run({ kind: 'artifact.rename', slug: 'x', title: 'New' });
    await run({ kind: 'artifact.pin', slug: 'x', pinned: false });
    await run({ kind: 'artifact.delete', slug: 'x' });
    expect(cloudLog).toEqual(['rename x New', 'refresh artifacts true', 'pin x false', 'refresh artifacts true', 'delete x', 'refresh artifacts true']);
  });

  it('says claude.ai refused, and still re-reads the list', async () => {
    const r = await run({ kind: 'artifact.delete', slug: 'x' }, { cloud: fakeCloud({ deleteArtifact: async () => false }) });
    expect(r).toEqual({ ok: false, error: 'cloud' });
    expect(cloudLog).toEqual(['refresh artifacts true']);
  });

  it('runs and pauses a routine only as the freshest list allows', async () => {
    expect(await run({ kind: 'routine.run', id: 'r1' })).toEqual({ ok: true });
    expect(await run({ kind: 'routine.pause', id: 'r1', paused: true })).toEqual({ ok: true });
    // Already running: resuming is stale.
    expect(await run({ kind: 'routine.pause', id: 'r1', paused: false })).toEqual({ ok: false, error: 'stale' });
    routine = { id: 'r1', name: 'Once', enabled: false, fired: true, repos: [] };
    expect(await run({ kind: 'routine.run', id: 'r1' })).toEqual({ ok: false, error: 'stale' });
    // A spent one-shot is never resumed: it might run at once.
    expect(await run({ kind: 'routine.pause', id: 'r1', paused: false })).toEqual({ ok: false, error: 'stale' });
    expect(cloudLog.filter((l) => !l.startsWith('refresh'))).toEqual(['run r1', 'enabled r1 false']);
  });

  it('files pages in a project and in a Sessions folder, both shared with V1', async () => {
    await run({ kind: 'artifact.project', slugs: ['x', 'y'], project: 'Koh' });
    const projects = await readArtifactProjects(join(home, 'artifact-projects.json'));
    // V1 files under the project's key; its display name comes back from the key.
    expect(projects.filed).toMatchObject({ x: 'koh', y: 'koh' });
    await run({ kind: 'artifact.folder', slug: 'x', title: 'Plan', folder: 'g1' });
    expect((await groups()).artifacts['x']).toMatchObject({ group: 'g1', title: 'Plan' });
  });

  it('copies links and opens a routine', async () => {
    await run({ kind: 'artifact.copyLink', slug: 'x' });
    await run({ kind: 'routine.copyLink', id: 'r1' });
    await run({ kind: 'routine.open', id: 'r1' });
    expect(copied).toEqual(['https://claude.ai/artifact/x', 'https://claude.ai/code/routines/r1']);
    expect(calls).toEqual([['open', 'https://claude.ai/code/routines/r1']]);
  });
});

describe('processes', () => {
  it('kills what the fresh reading finds, children included, once confirmed', async () => {
    expect(await run({ kind: 'process.kill', pid: 400 })).toEqual({ ok: true });
    // Deepest first, the process itself last (V1 kill.ts): a parent killed alone leaves orphans.
    expect(killed).toEqual([401, 400]);
  });

  it('kills nothing when cancelled, or when the pid is no longer one of ours', async () => {
    await run({ kind: 'process.kill', pid: 400 }, { confirmKill: async () => false });
    expect(await run({ kind: 'process.kill', pid: 999 })).toEqual({ ok: false, error: 'stale' });
    expect(killed).toEqual([]);
  });

  it('copies a pid or a command line', async () => {
    await run({ kind: 'process.copy', pid: 400, what: 'pid' });
    await run({ kind: 'process.copy', pid: 400, what: 'command' });
    expect(copied[0]).toBe('400');
    expect(copied[1]).toContain('vite');
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
      { kind: 'setting.sound', event: 'done' },
      { kind: 'artifact.delete', slug: 'a/b' },
      { kind: 'artifact.rename', slug: 'x', title: '  ' },
      { kind: 'artifact.project', slugs: [], project: 'p' },
      { kind: 'process.kill', pid: 1 },
      { kind: 'process.kill', pid: -4 },
      { kind: 'routine.run', id: '../x' },
    ]) {
      expect(parseAction(bad), JSON.stringify(bad)).toBeUndefined();
    }
  });
});
