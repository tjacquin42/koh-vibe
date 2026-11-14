import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MENU_ITEMS, parseTarget, runMenu, whenOf, type MenuDeps } from '../src/host/menus';
import type { Action } from '../src/shared/actions';

const root = join(__dirname, '..');
const read = (f: string): Record<string, unknown> => JSON.parse(readFileSync(join(root, f), 'utf8')) as Record<string, unknown>;

describe('package.json follows the menu list', () => {
  const pkg = read('package.json') as { contributes: { commands: { command: string; title: string }[]; menus: Record<string, { command: string; when: string; group?: string }[]> } };
  const en = read('package.nls.json');
  const fr = read('package.nls.fr.json');

  it('declares every item: command, right-click entry, hidden from the palette, titled in both languages', () => {
    for (const m of MENU_ITEMS) {
      expect(pkg.contributes.commands.find((x) => x.command === m.command)?.title, m.command).toBe(`%command.${m.command}.title%`);
      expect(pkg.contributes.menus['webview/context']?.find((x) => x.command === m.command), m.command).toEqual({ command: m.command, when: whenOf(m), group: m.group });
      expect(pkg.contributes.menus['commandPalette']?.find((x) => x.command === m.command)?.when, m.command).toBe('false');
      expect(en[`command.${m.command}.title`], m.command).toBe(m.en);
      expect(fr[`command.${m.command}.title`], m.command).toBe(m.fr);
    }
    // And nothing the list no longer has.
    const known = new Set(MENU_ITEMS.map((m) => m.command));
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
    ask: async () => 'Renamed',
    pickColor: async () => 'pink',
    confirm: async () => true,
    t: (m) => m,
    report: () => undefined,
    ...over,
  };
  return { d, acts, calls };
}

describe('right-click commands', () => {
  it('reads only well-formed rows', () => {
    expect(parseTarget({ webviewSection: 'kvnSession', kvnSessionId: 'a', kvnPid: 12 })).toEqual({ section: 'kvnSession', sessionId: 'a', pid: 12 });
    expect(parseTarget({ webviewSection: 'treeItem' })).toBeUndefined();
    expect(parseTarget({ webviewSection: 'kvnProcess', kvnPid: 1 })).toEqual({ section: 'kvnProcess' });
    expect(parseTarget('nope')).toBeUndefined();
  });

  it('runs the row actions, asking first where the view would', async () => {
    const { d, acts, calls } = deps();
    await runMenu('kohVibeNext.ctx.session.sleep', { webviewSection: 'kvnSession', kvnSessionId: 'a' }, d);
    await runMenu('kohVibeNext.ctx.session.sheet', { webviewSection: 'kvnSession', kvnSessionId: 'a' }, d);
    await runMenu('kohVibeNext.ctx.folder.rename', { webviewSection: 'kvnFolder', kvnFolderId: 'g', kvnName: 'Old' }, d);
    await runMenu('kohVibeNext.ctx.folder.color', { webviewSection: 'kvnFolder', kvnFolderId: 'g' }, d);
    await runMenu('kohVibeNext.ctx.artifact.unpin', { webviewSection: 'kvnArtifact', kvnSlug: 'x' }, d);
    await runMenu('kohVibeNext.ctx.process.kill', { webviewSection: 'kvnProcess', kvnPid: 400 }, d);
    expect(acts).toEqual([
      { kind: 'session.command', command: 'sleep', id: 'a' },
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
