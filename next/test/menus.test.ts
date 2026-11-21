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

describe('what every right-click item sends, row by row', () => {
  const row = (webviewSection: string, extra: Record<string, unknown>): Record<string, unknown> => ({ webviewSection, ...extra });

  it('brings a conversation’s tab forward, copies its id, and reopens a closed one', async () => {
    const { d, acts, calls } = deps();
    await runMenu('session.open', row('kvnSession', { kvnSessionId: 'a' }), d);
    await runMenu('session.close', row('kvnSession', { kvnSessionId: 'a' }), d);
    await runMenu('session.copyId', row('kvnSession', { kvnSessionId: 'a' }), d);
    await runMenu('closed.copyId', row('kvnClosed', { kvnSessionId: 'c' }), d);
    await runMenu('closed.reopen', row('kvnClosed', { kvnSessionId: 'c' }), d);
    expect(calls).toEqual(['open a', 'reopen c']);
    expect(acts).toEqual([
      { kind: 'session.command', command: 'close', id: 'a' },
      { kind: 'session.copyId', id: 'a' },
      { kind: 'session.copyId', id: 'c' },
    ]);
  });

  it('starts a conversation in the folder it was asked in, or in none from the unfiled list', async () => {
    const { d, acts } = deps();
    await runMenu('folder.newSession', row('kvnFolder', { kvnFolderId: 'g' }), d);
    await runMenu('unfiled.newSession', row('kvnUnfiled', {}), d);
    expect(acts).toEqual([{ kind: 'session.new', folder: 'g' }, { kind: 'session.new' }]);
  });

  it('adds a rule to a folder, or opens its rules, by which item was clicked', async () => {
    const { d, acts } = deps();
    await runMenu('folder.addRule', row('kvnFolder', { kvnFolderId: 'g' }), d);
    await runMenu('folder.openRules', row('kvnFolder', { kvnFolderId: 'g' }), d);
    expect(acts).toEqual([
      { kind: 'folder.rules', id: 'g', mode: 'add' },
      { kind: 'folder.rules', id: 'g', mode: 'open' },
    ]);
  });

  it('deletes a folder only after a yes that names it, and keeps a rename that is empty, too long or unchanged out of the action', async () => {
    const asked: string[] = [];
    const { d, acts } = deps({
      t: hostTranslator(undefined),
      confirm: async (m) => {
        asked.push(m);
        return true;
      },
    });
    await runMenu('folder.delete', row('kvnFolder', { kvnFolderId: 'g', kvnName: 'Shop' }), d);
    expect(asked).toEqual(['Delete « Shop »? Its conversations stay, out of any folder.']);
    expect(acts).toEqual([{ kind: 'folder.delete', id: 'g' }]);
    for (const typed of ['   ', 'x'.repeat(500), 'Same']) {
      const r = deps({ ask: async () => typed });
      await runMenu('folder.rename', row('kvnFolder', { kvnFolderId: 'g', kvnName: 'Same' }), r.d);
      expect(r.acts, typed.slice(0, 4)).toEqual([]);
    }
  });

  it('pins and unpins an artifact, renames it with what was typed, and leaves an unchanged title alone', async () => {
    const { d, acts } = deps({ ask: async () => '  New page  ' });
    await runMenu('artifact.pin', row('kvnArtifact', { kvnSlug: 's' }), d);
    await runMenu('artifact.rename', row('kvnArtifact', { kvnSlug: 's', kvnTitle: 'Old' }), d);
    await runMenu('artifact.copyLink', row('kvnArtifact', { kvnSlug: 's' }), d);
    expect(acts).toEqual([
      { kind: 'artifact.pin', slug: 's', pinned: true },
      { kind: 'artifact.rename', slug: 's', title: 'New page' },
      { kind: 'artifact.copyLink', slug: 's' },
    ]);
    const same = deps({ ask: async () => 'Old' });
    await runMenu('artifact.rename', row('kvnArtifact', { kvnSlug: 's', kvnTitle: 'Old' }), same.d);
    expect(same.acts).toEqual([]);
  });

  it('deletes an artifact from claude.ai only after a yes, naming its title or else its slug', async () => {
    const asked: string[] = [];
    const { d, acts } = deps({
      t: hostTranslator(undefined),
      confirm: async (m) => {
        asked.push(m);
        return true;
      },
    });
    await runMenu('artifact.delete', row('kvnArtifact', { kvnSlug: 's', kvnTitle: 'Plan' }), d);
    await runMenu('artifact.delete', row('kvnArtifact', { kvnSlug: 's2' }), d);
    expect(asked[0]).toContain('« Plan »');
    expect(asked[1]).toContain('« s2 »');
    expect(acts).toEqual([
      { kind: 'artifact.delete', slug: 's' },
      { kind: 'artifact.delete', slug: 's2' },
    ]);
  });

  it('runs a routine only after a yes, and pauses, resumes, opens and links it otherwise', async () => {
    const { d, acts } = deps();
    await runMenu('routine.run', row('kvnRoutine', { kvnRoutineId: 'r' }), d);
    await runMenu('routine.pause', row('kvnRoutine', { kvnRoutineId: 'r' }), d);
    await runMenu('routine.resume', row('kvnRoutine', { kvnRoutineId: 'r' }), d);
    await runMenu('routine.open', row('kvnRoutine', { kvnRoutineId: 'r' }), d);
    await runMenu('routine.copyLink', row('kvnRoutine', { kvnRoutineId: 'r' }), d);
    expect(acts).toEqual([
      { kind: 'routine.run', id: 'r' },
      { kind: 'routine.pause', id: 'r', paused: true },
      { kind: 'routine.pause', id: 'r', paused: false },
      { kind: 'routine.open', id: 'r' },
      { kind: 'routine.copyLink', id: 'r' },
    ]);
  });

  it('copies a process’s command or its pid', async () => {
    const { d, acts } = deps();
    await runMenu('process.copyCommand', row('kvnProcess', { kvnPid: 400 }), d);
    await runMenu('process.copyPid', row('kvnProcess', { kvnPid: 400 }), d);
    expect(acts).toEqual([
      { kind: 'process.copy', pid: 400, what: 'command' },
      { kind: 'process.copy', pid: 400, what: 'pid' },
    ]);
  });

  it('does nothing for an item whose row lacks the id it needs, or that it does not know', async () => {
    const { d, acts, calls } = deps();
    for (const c of ['session.open', 'session.sheet', 'session.copyId', 'closed.reopen', 'folder.newSession', 'folder.rename', 'artifact.open', 'artifact.rename', 'routine.run', 'process.kill', 'nope']) {
      await runMenu(c, row('kvnSession', {}), d);
    }
    await runMenu('artProject.rename', row('kvnArtProject', {}), d);
    expect(acts).toEqual([]);
    expect(calls).toEqual([]);
  });

  it('reports a failure instead of throwing when an action or a box breaks', async () => {
    const reports: unknown[] = [];
    const { d } = deps({
      act: async () => {
        throw new Error('boom');
      },
      report: (r) => reports.push(r),
    });
    await expect(runMenu('session.close', row('kvnSession', { kvnSessionId: 'a' }), d)).resolves.toBeUndefined();
    expect(reports).toEqual([{ ok: false, error: 'failed' }]);
  });

  it('hands the result of an action to report, so a refusal is said the way the view says it', async () => {
    const reports: unknown[] = [];
    const { d } = deps({ act: async () => ({ ok: false, error: 'stale' }), report: (r) => reports.push(r) });
    await runMenu('session.sleep', row('kvnSession', { kvnSessionId: 'a' }), d);
    expect(reports).toEqual([{ ok: false, error: 'stale' }]);
  });

  it('ignores a click whose row is not well formed', async () => {
    const { d, acts } = deps();
    await runMenu('session.close', 'nope', d);
    expect(acts).toEqual([]);
  });
});
