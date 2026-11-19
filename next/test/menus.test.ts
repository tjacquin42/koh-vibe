import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { frCommand, hostTranslator, MENU_ITEMS, parseTarget, runMenu, whenOf, type MenuDeps } from '../src/host/menus';
import type { Action } from '../src/shared/actions';

const root = join(__dirname, '..');
const read = (f: string): Record<string, unknown> => JSON.parse(readFileSync(join(root, f), 'utf8')) as Record<string, unknown>;

describe('package.json follows the menu list', () => {
  const pkg = read('package.json') as { contributes: { commands: { command: string; title: string }[]; menus: Record<string, { command: string; when: string; group?: string }[]> } };
  const en = read('package.nls.json');
  const fr = read('package.nls.fr.json');

  it('declares every item twice — in English and in French — and shows the one of Koh-Vibe’s language, not the editor’s (19/11)', () => {
    for (const m of MENU_ITEMS) {
      for (const [command, title, lang] of [[m.command, m.en, '!kvnFr'], [frCommand(m), m.fr, 'kvnFr']] as const) {
        expect(pkg.contributes.commands.find((x) => x.command === command)?.title, command).toBe(title);
        expect(pkg.contributes.menus['webview/context']?.find((x) => x.command === command), command).toEqual({ command, when: `${whenOf(m)} && ${lang}`, group: m.group });
        expect(pkg.contributes.menus['commandPalette']?.find((x) => x.command === command)?.when, command).toBe('false');
        // Titled in the manifest itself: a translation file would follow the editor's language.
        expect(en[`command.${command}.title`], command).toBeUndefined();
        expect(fr[`command.${command}.title`], command).toBeUndefined();
      }
    }
    // And nothing the list no longer has.
    const known = new Set(MENU_ITEMS.flatMap((m) => [m.command, frCommand(m)]));
    expect(pkg.contributes.menus['webview/context']?.every((x) => known.has(x.command))).toBe(true);
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
    await runMenu('kohVibeNext.ctx.artProject.rename', { webviewSection: 'kvnArtProject', kvnName: 'nti' }, d);
    expect(acts).toEqual([{ kind: 'artifact.renameProject', from: 'nti', to: 'NTI tests', slugs: ['a1', 'a2'] }]);
    const same = deps({ ask: async () => 'nti' });
    await runMenu('kohVibeNext.ctx.artProject.rename', { webviewSection: 'kvnArtProject', kvnName: 'nti' }, same.d);
    expect(same.acts).toEqual([]);
  });

  it('opens an artifact where the settings say, not always in the browser', async () => {
    const { d, calls } = deps();
    await runMenu('kohVibeNext.ctx.artifact.open', { webviewSection: 'kvnArtifact', kvnSlug: 'abc' }, d);
    expect(calls).toEqual(['artifact abc']);
  });

  it('runs the row actions, asking first where the view would', async () => {
    const { d, acts, calls } = deps();
    await runMenu('kohVibeNext.ctx.session.sleep', { webviewSection: 'kvnSession', kvnSessionId: 'a' }, d);
    await runMenu('kohVibeNext.ctx.session.sheet', { webviewSection: 'kvnSession', kvnSessionId: 'a' }, d);
    await runMenu('kohVibeNext.ctx.session.unread', { webviewSection: 'kvnSession', kvnSessionId: 'a' }, d);
    await runMenu('kohVibeNext.ctx.folder.rename', { webviewSection: 'kvnFolder', kvnFolderId: 'g', kvnName: 'Old' }, d);
    await runMenu('kohVibeNext.ctx.folder.color', { webviewSection: 'kvnFolder', kvnFolderId: 'g' }, d);
    await runMenu('kohVibeNext.ctx.artifact.unpin', { webviewSection: 'kvnArtifact', kvnSlug: 'x' }, d);
    await runMenu('kohVibeNext.ctx.process.kill', { webviewSection: 'kvnProcess', kvnPid: 400 }, d);
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
    await runMenu('kohVibeNext.ctx.artifact.delete', { webviewSection: 'kvnArtifact', kvnSlug: 'x' }, d);
    await runMenu('kohVibeNext.ctx.routine.run', { webviewSection: 'kvnRoutine', kvnRoutineId: 'r' }, d);
    await runMenu('kohVibeNext.ctx.folder.delete', { webviewSection: 'kvnFolder', kvnFolderId: 'g' }, d);
    await runMenu('kohVibeNext.ctx.folder.rename', { webviewSection: 'kvnFolder', kvnFolderId: 'g' }, d);
    await runMenu('kohVibeNext.ctx.folder.color', { webviewSection: 'kvnFolder', kvnFolderId: 'g' }, d);
    expect(acts).toEqual([]);
  });
});
