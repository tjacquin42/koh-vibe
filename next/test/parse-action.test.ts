import { describe, expect, it } from 'vitest';
import { MAX_NAME, MAX_TITLE, parseAction, type Action } from '../src/shared/actions';
import { DEFAULT_THEME } from '../src/shared/theme';

/**
 * What the view may ask the host to change arrives as a message, and the
 * host trusts none of it (shared/actions.ts `parseAction`). One good example
 * of every action — the record is checked against the union, so an action
 * added without one does not compile — and what must never get through.
 */
const GOOD: { [K in Action['kind']]: Extract<Action, { kind: K }>[] } = {
  'folder.create': [{ kind: 'folder.create', name: 'Video' }],
  'folder.rename': [{ kind: 'folder.rename', id: 'g1', name: 'Video' }],
  'folder.color': [
    { kind: 'folder.color', id: 'g1', color: 'blue' },
    { kind: 'folder.color', id: 'g1', color: null },
  ],
  'folder.delete': [{ kind: 'folder.delete', id: 'g1' }],
  'folder.rules': [
    { kind: 'folder.rules', id: 'g1', mode: 'add' },
    { kind: 'folder.rules', id: 'g1', mode: 'open' },
  ],
  'folder.move': [
    { kind: 'folder.move', ids: ['g1'] },
    { kind: 'folder.move', ids: ['g1'], before: 'g2' },
  ],
  'session.file': [
    { kind: 'session.file', ids: ['a'], order: ['a', 'b'] },
    { kind: 'session.file', ids: ['a'], folder: 'g1', order: [] },
  ],
  'session.command': [
    { kind: 'session.command', command: 'sleep', id: 'a' },
    { kind: 'session.command', command: 'close', id: 'a' },
  ],
  'session.new': [{ kind: 'session.new' }, { kind: 'session.new', folder: 'g1' }],
  'session.copyId': [{ kind: 'session.copyId', id: 'a' }],
  'setting.toggle': [{ kind: 'setting.toggle', key: 'animate', on: false }],
  'setting.volume': [
    { kind: 'setting.volume', percent: 0 },
    { kind: 'setting.volume', percent: 100 },
  ],
  'setting.editorTabs': [{ kind: 'setting.editorTabs', mode: 'single' }],
  'setting.language': [{ kind: 'setting.language', choice: 'fr' }],
  'setting.artifactOpen': [{ kind: 'setting.artifactOpen', where: 'editor' }],
  'artifact.rename': [{ kind: 'artifact.rename', slug: 'abc-123', title: 'Notes' }],
  'artifact.pin': [{ kind: 'artifact.pin', slug: 'abc-123', pinned: true }],
  'artifact.delete': [{ kind: 'artifact.delete', slug: 'abc-123' }],
  'artifact.project': [
    { kind: 'artifact.project', slugs: ['abc-123'], project: 'Koh-Vibe' },
    { kind: 'artifact.project', slugs: ['abc-123'], project: null },
  ],
  'artifact.renameProject': [{ kind: 'artifact.renameProject', from: 'Old', to: 'New', slugs: ['abc-123'] }],
  'artifact.folder': [
    { kind: 'artifact.folder', slug: 'abc-123', title: '' },
    { kind: 'artifact.folder', slug: 'abc-123', title: 'Notes', folder: 'g1' },
  ],
  'artifact.copyLink': [{ kind: 'artifact.copyLink', slug: 'abc-123' }],
  'artifact.tidy': [{ kind: 'artifact.tidy' }],
  'tidy.settings': [{ kind: 'tidy.settings', ask: false }],
  'tidy.rules': [{ kind: 'tidy.rules', mode: 'add' }],
  'theme.set': [{ kind: 'theme.set', theme: DEFAULT_THEME }],
  'theme.ide': [{ kind: 'theme.ide', mode: 'restore' }],
  'hooks.install': [{ kind: 'hooks.install' }],
  'cloud.refresh': [{ kind: 'cloud.refresh', what: 'routines' }],
  'routine.run': [{ kind: 'routine.run', id: 'trig_01' }],
  'routine.pause': [{ kind: 'routine.pause', id: 'trig_01', paused: true }],
  'routine.copyLink': [{ kind: 'routine.copyLink', id: 'trig_01' }],
  'routine.open': [{ kind: 'routine.open', id: 'trig_01' }],
  'process.copy': [
    { kind: 'process.copy', pid: 4120, what: 'pid' },
    { kind: 'process.copy', pid: 4120, what: 'command' },
  ],
  'process.kill': [{ kind: 'process.kill', pid: 4120 }],
};

const all = Object.values(GOOD).flat();

describe('parseAction, action by action', () => {
  it.each(all.map((a) => [JSON.stringify(a), a] as const))('lets through %s', (_said, action) => {
    // As it arrives: a copy that went through a message, not the object itself.
    expect(parseAction(JSON.parse(JSON.stringify(action)))).toEqual(action);
  });

  it('keeps nothing a message adds beyond what the action takes', () => {
    expect(parseAction({ kind: 'folder.delete', id: 'g1', also: 'rm -rf', __proto__: { x: 1 } })).toEqual({ kind: 'folder.delete', id: 'g1' });
    expect(parseAction({ kind: 'hooks.install', path: '/etc' })).toEqual({ kind: 'hooks.install' });
  });

  it('trims a name, and takes a title as typed but for its ends', () => {
    expect(parseAction({ kind: 'folder.rename', id: 'g1', name: '  Video  ' })).toEqual({ kind: 'folder.rename', id: 'g1', name: 'Video' });
    expect(parseAction({ kind: 'artifact.rename', slug: 'a', title: '  Notes ' })).toEqual({ kind: 'artifact.rename', slug: 'a', title: 'Notes' });
    expect(parseAction({ kind: 'artifact.renameProject', from: ' Old ', to: ' New ', slugs: ['a'] })).toEqual({ kind: 'artifact.renameProject', from: 'Old', to: 'New', slugs: ['a'] });
  });

  const long = (n: number): string => 'x'.repeat(n);
  const BAD: readonly unknown[] = [
    // Not an action at all.
    undefined,
    null,
    'folder.delete',
    ['folder.delete'],
    {},
    { kind: 'folder.destroy', id: 'g1' },
    // An id that is a path, empty, too long, or not a string.
    { kind: 'folder.delete', id: '../groups' },
    { kind: 'folder.delete', id: 'a\\b' },
    { kind: 'folder.delete', id: 'a\0b' },
    { kind: 'folder.delete', id: '' },
    { kind: 'folder.delete', id: long(129) },
    { kind: 'folder.delete', id: 7 },
    { kind: 'session.copyId' },
    { kind: 'session.command', command: 'delete', id: 'a' },
    { kind: 'session.command', command: 'sleep', id: 'a/b' },
    { kind: 'session.new', folder: '' },
    { kind: 'session.file', ids: [], order: [] },
    { kind: 'session.file', ids: ['a'] },
    { kind: 'session.file', ids: ['a'], order: ['ok', 3] },
    { kind: 'session.file', ids: ['a'], order: [], folder: 'x/y' },
    { kind: 'folder.move', ids: [] },
    { kind: 'folder.move', ids: 'g1' },
    { kind: 'folder.move', ids: ['g1'], before: 4 },
    // A name that is blank or too long; a colour off the palette.
    { kind: 'folder.create', name: '   ' },
    { kind: 'folder.create', name: long(MAX_NAME + 1) },
    { kind: 'folder.rename', id: 'g1' },
    { kind: 'folder.color', id: 'g1', color: '#ff0000' },
    { kind: 'folder.color', id: 'g1' },
    { kind: 'folder.rules', id: 'g1', mode: 'delete' },
    // Settings out of their range.
    { kind: 'setting.toggle', key: 'telemetry', on: true },
    { kind: 'setting.toggle', key: 'animate', on: 'yes' },
    { kind: 'setting.volume', percent: 101 },
    { kind: 'setting.volume', percent: -5 },
    { kind: 'setting.volume', percent: 12.5 },
    { kind: 'setting.volume', percent: '50' },
    { kind: 'setting.editorTabs', mode: 'many' },
    { kind: 'setting.language', choice: 'de' },
    { kind: 'setting.artifactOpen', where: 'cockpit' },
    { kind: 'tidy.settings', ask: 1 },
    { kind: 'tidy.rules', mode: 'erase' },
    { kind: 'theme.set', theme: { current: 'red' } },
    { kind: 'theme.ide', mode: 'paint' },
    { kind: 'cloud.refresh', what: 'everything' },
    // A slug ends up in a URL: nothing but what claude.ai writes.
    { kind: 'artifact.delete', slug: '../../etc' },
    { kind: 'artifact.delete', slug: 'a b' },
    { kind: 'artifact.delete', slug: 'a?x=1' },
    { kind: 'artifact.delete', slug: long(129) },
    { kind: 'artifact.pin', slug: 'a', pinned: 'true' },
    { kind: 'artifact.rename', slug: 'a', title: '   ' },
    { kind: 'artifact.rename', slug: 'a', title: long(MAX_TITLE + 1) },
    { kind: 'artifact.project', slugs: [], project: 'P' },
    { kind: 'artifact.project', slugs: ['a', '../b'], project: 'P' },
    { kind: 'artifact.project', slugs: ['a'], project: '  ' },
    { kind: 'artifact.project', slugs: ['a'] },
    { kind: 'artifact.renameProject', from: 'Old', to: '', slugs: ['a'] },
    { kind: 'artifact.renameProject', from: 'Old', to: 'New', slugs: [] },
    { kind: 'artifact.folder', slug: 'a', title: 5 },
    { kind: 'artifact.folder', slug: 'a', title: 'T', folder: '../x' },
    { kind: 'artifact.copyLink', slug: 'a/b' },
    { kind: 'routine.run', id: 'trig/01' },
    { kind: 'routine.pause', id: 'trig_01' },
    // A pid: a whole number, and never the system's own first processes.
    { kind: 'process.kill', pid: 1 },
    { kind: 'process.kill', pid: 0 },
    { kind: 'process.kill', pid: -4120 },
    { kind: 'process.kill', pid: 41.5 },
    { kind: 'process.kill', pid: '4120' },
    { kind: 'process.copy', pid: 4120, what: 'environment' },
  ];

  it.each(BAD.map((b) => [JSON.stringify(b) ?? String(b), b] as const))('drops %s', (_said, bad) => {
    expect(parseAction(bad)).toBeUndefined();
  });

  it('drops a list of ids too long to be a drop', () => {
    const many = Array.from({ length: 5_000 }, (_, i) => `s${i}`);
    expect(parseAction({ kind: 'session.file', ids: many, order: [] })).toBeUndefined();
  });
});
