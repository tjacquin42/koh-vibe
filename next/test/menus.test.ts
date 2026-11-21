import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { hostTranslator, parseTarget, runMenu, type MenuDeps } from '../src/host/menus';
import { isMenuId, MENU_ITEMS, menuGroups } from '../src/shared/menus';
import type { Action } from '../src/shared/actions';

const root = join(__dirname, '..');
const read = (f: string): unknown => JSON.parse(readFileSync(join(root, f), 'utf8'));

describe('the right-click menus are Koh-Vibe’s own (21/11)', () => {
  const pkg = read('package.json') as { contributes: { commands: { command: string }[]; menus?: Record<string, { command: string }[]> } };
  const rootPkg = JSON.parse(readFileSync(join(root, '..', 'package.json'), 'utf8')) as typeof pkg;

  it('declares nothing in the editor’s menus any more: no command, no webview/context entry', () => {
    for (const p of [pkg, rootPkg]) {
      expect(p.contributes.commands.filter((c) => c.command.startsWith('kohVibeNext.ctx.'))).toEqual([]);
      expect(p.contributes.menus?.['webview/context']).toBeUndefined();
    }
  });

  it('runs every item it lists, with an id of its own and a title in both languages', async () => {
    expect(new Set(MENU_ITEMS.map((m) => m.id)).size).toBe(MENU_ITEMS.length);
    for (const m of MENU_ITEMS) {
      expect(m.en.length > 0 && m.fr.length > 0, m.id).toBe(true);
      expect(isMenuId(m.id)).toBe(true);
    }
    expect(isMenuId('kohVibeNext.ctx.session.open')).toBe(false);
  });

  it('lists the items of the row’s kind whose flags hold, in groups, in order', () => {
    const ids = (c: Record<string, unknown>): string[][] => menuGroups(c).map((g) => g.map((m) => m.id));
    expect(ids({ webviewSection: 'kvnSession', kvnFiled: true })).toEqual([['session.open', 'session.sheet'], ['session.sleep', 'session.close'], ['session.copyId']]);
    expect(ids({ webviewSection: 'kvnSession', kvnEnded: true, kvnFiled: true, kvnCanUnread: true })).toEqual([
      ['session.open', 'session.sheet'],
      ['session.close'],
      ['session.unread'],
      ['session.copyId'],
    ]);
    expect(ids({ webviewSection: 'kvnArtifact', kvnPinned: true })[1]).toEqual(['artifact.unpin', 'artifact.rename']);
    expect(ids({ webviewSection: 'kvnUnfiled' })).toEqual([['unfiled.newSession']]);
    // A flag must be true itself: a string « true » from a page is not.
    expect(ids({ webviewSection: 'kvnClosed', kvnResumable: 'true' })).toEqual([['closed.copyId']]);
    expect(menuGroups({ webviewSection: 'treeItem' })).toEqual([]);
    expect(menuGroups({})).toEqual([]);
  });
});

function deps(over: Partial<MenuDeps> = {}) {
  const acts: Action[] = [];
  const calls: string[] = [];
  const d: MenuDeps = {
    act: async (a) => {
      acts.push(a);
      return { ok: true };
    },
    open: (id) => calls.push(`open ${id}`),
    sheet: (id) => calls.push(`sheet ${id}`),
    reopen: (id) => calls.push(`reopen ${id}`),
    openUrl: (u) => calls.push(`url ${u}`),
    openArtifact: (slug) => calls.push(`artifact ${slug}`),
    ask: async () => 'Renamed',
    pickColor: async () => 'pink',
    confirm: async () => true,
    t: (m) => m,
    report: () => undefined,
    projectSlugs: (project) => (project === 'nti' ? ['a1', 'a2'] : []),
    ...over,
  };
  return { d, acts, calls };
}

describe('what the right-click asks, in Koh-Vibe’s language (19/11)', () => {
  const bundle = { 'New folder name': 'Nouveau nom du dossier', 'Delete « {0} »?': 'Supprimer « {0} » ?' };
  it('says it in French from the bundle, filling its blanks, and in English as written otherwise', () => {
    expect(hostTranslator(bundle)('New folder name')).toBe('Nouveau nom du dossier');
    expect(hostTranslator(bundle)('Delete « {0} »?', 'Shop')).toBe('Supprimer « Shop » ?');
    expect(hostTranslator(undefined)('Delete « {0} »?', 'Shop')).toBe('Delete « Shop »?');
    // Not translated yet: English, never an empty string.
    expect(hostTranslator(bundle)('Rename')).toBe('Rename');
  });
});

describe('right-click commands', () => {
  it('reads only well-formed rows', () => {
    expect(parseTarget({ webviewSection: 'kvnSession', kvnSessionId: 'a', kvnPid: 12 })).toEqual({ section: 'kvnSession', sessionId: 'a', pid: 12 });
    expect(parseTarget({ webviewSection: 'treeItem' })).toBeUndefined();
    expect(parseTarget({ webviewSection: 'kvnProcess', kvnPid: 1 })).toEqual({ section: 'kvnProcess' });
    expect(parseTarget('nope')).toBeUndefined();
  });

  it('renames an artifact project folder, with what it shows, and leaves a name unchanged alone', async () => {
    const { d, acts } = deps({ ask: async () => ' NTI tests ' });
    await runMenu('artProject.rename', { webviewSection: 'kvnArtProject', kvnName: 'nti' }, d);
    expect(acts).toEqual([{ kind: 'artifact.renameProject', from: 'nti', to: 'NTI tests', slugs: ['a1', 'a2'] }]);
    const same = deps({ ask: async () => 'nti' });
    await runMenu('artProject.rename', { webviewSection: 'kvnArtProject', kvnName: 'nti' }, same.d);
    expect(same.acts).toEqual([]);
  });

  it('opens an artifact where the settings say, not always in the browser', async () => {
    const { d, calls } = deps();
    await runMenu('artifact.open', { webviewSection: 'kvnArtifact', kvnSlug: 'abc' }, d);
    expect(calls).toEqual(['artifact abc']);
  });

  it('runs the row actions, asking first where the view would', async () => {
    const { d, acts, calls } = deps();
    await runMenu('session.sleep', { webviewSection: 'kvnSession', kvnSessionId: 'a' }, d);
    await runMenu('session.sheet', { webviewSection: 'kvnSession', kvnSessionId: 'a' }, d);
    await runMenu('session.unread', { webviewSection: 'kvnSession', kvnSessionId: 'a' }, d);
    await runMenu('folder.rename', { webviewSection: 'kvnFolder', kvnFolderId: 'g', kvnName: 'Old' }, d);
    await runMenu('folder.color', { webviewSection: 'kvnFolder', kvnFolderId: 'g' }, d);
    await runMenu('artifact.unpin', { webviewSection: 'kvnArtifact', kvnSlug: 'x' }, d);
    await runMenu('process.kill', { webviewSection: 'kvnProcess', kvnPid: 400 }, d);
    expect(acts).toEqual([
      { kind: 'session.command', command: 'sleep', id: 'a' },
      { kind: 'session.command', command: 'unread', id: 'a' },
      { kind: 'folder.rename', id: 'g', name: 'Renamed' },
      { kind: 'folder.color', id: 'g', color: 'pink' },
      { kind: 'artifact.pin', slug: 'x', pinned: false },
      { kind: 'process.kill', pid: 400 },
    ]);
    expect(calls).toEqual(['sheet a']);
  });

  it('does nothing when the answer is no, or the box is cancelled', async () => {
    const { d, acts } = deps({ confirm: async () => false, ask: async () => undefined, pickColor: async () => undefined });
    await runMenu('artifact.delete', { webviewSection: 'kvnArtifact', kvnSlug: 'x' }, d);
    await runMenu('routine.run', { webviewSection: 'kvnRoutine', kvnRoutineId: 'r' }, d);
    await runMenu('folder.delete', { webviewSection: 'kvnFolder', kvnFolderId: 'g' }, d);
    await runMenu('folder.rename', { webviewSection: 'kvnFolder', kvnFolderId: 'g' }, d);
    await runMenu('folder.color', { webviewSection: 'kvnFolder', kvnFolderId: 'g' }, d);
    expect(acts).toEqual([]);
  });
});
