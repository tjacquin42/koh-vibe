import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// The contribution points VSCode reads from package.json, typed to what these
// tests look at. A menu entry that goes missing fails silently at runtime —
// the button is simply not there — which is why it is asserted here.
type Command = { command: string; icon?: string | { light: string; dark: string } };
type MenuEntry = { command: string; when?: string; group?: string };
type View = { id: string; visibility?: string };
type Manifest = {
  contributes: { commands: Command[]; menus: Record<string, MenuEntry[]>; views: Record<string, View[]> };
};

const manifest = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8')) as Manifest;
const inline = (command: string): MenuEntry[] =>
  manifest.contributes.menus['view/item/context']!.filter((m) => m.command === command && (m.group ?? '').startsWith('inline'));
const context = (command: string): MenuEntry[] =>
  manifest.contributes.menus['view/item/context']!.filter((m) => m.command === command);
const icon = (command: string): Command['icon'] => manifest.contributes.commands.find((c) => c.command === command)?.icon;
const palette = (command: string): MenuEntry | undefined =>
  manifest.contributes.menus['commandPalette']!.find((m) => m.command === command);
const viewIds = (): string[] => manifest.contributes.views['koh-vibe']!.map((v) => v.id);

describe('the manifest', () => {
  it('puts a + at the right of every folder row, temporary sessions included, with the same icon as the view title', () => {
    const [entry] = inline('kohVibe.newSessionInGroup');
    expect(entry?.when).toContain('viewItem == group');
    expect(entry?.when).toContain('viewItem == unfiled');
    expect(icon('kohVibe.newSessionInGroup')).toBe(icon('kohVibe.newSession'));
    expect(icon('kohVibe.newSession')).toBe('$(add)');
  });

  it('keeps the trash at the right of every session row, asleep ones included', () => {
    const [entry] = inline('kohVibe.closeSession');
    expect(entry?.when).toContain('viewItem =~ /^session/');
    expect(icon('kohVibe.closeSession')).toBe('$(trash)');
  });

  it('offers the id of a conversation on a live row and on a closed one', () => {
    const whens = context('kohVibe.copySessionId').map((m) => m.when ?? '');
    expect(whens.some((w) => w.includes('viewItem =~ /^session/'))).toBe(true);
    expect(whens.some((w) => w.includes('viewItem == closedSession'))).toBe(true);
  });

  it('keeps that copy out of the palette, which has no row to read an id from', () => {
    const palette = manifest.contributes.menus['commandPalette']!.find((m) => m.command === 'kohVibe.copySessionId');
    expect(palette?.when).toBe('false');
  });

  it('puts a moon beside the trash, and only where there is a tab to close', () => {
    const [entry] = inline('kohVibe.sleepSession');
    expect(entry?.when).toContain('viewItem == session');
    // Not the shared prefix: a greyed row has no tab left, and a conversation
    // started outside an editor never had one.
    expect(entry?.when).not.toContain('=~');
    expect(icon('kohVibe.sleepSession')).toEqual({ light: 'resources/moon-light.svg', dark: 'resources/moon-dark.svg' });
  });

  it('puts the moon before the trash, in the order the row reads', () => {
    expect(inline('kohVibe.sleepSession')[0]?.group).toBe('inline@1');
    expect(inline('kohVibe.closeSession')[0]?.group).toBe('inline@2');
  });

  it('lets every shared session menu reach a greyed row', () => {
    for (const command of ['kohVibe.closeSession', 'kohVibe.forgetSession', 'kohVibe.copySessionId', 'kohVibe.soundSession.waiting']) {
      const whens = context(command)
        .map((m) => m.when ?? '')
        .filter((w) => w.includes('view == kohVibe.sessions'));
      expect(whens.length).toBeGreaterThan(0);
      for (const w of whens) expect(w).toContain('viewItem =~ /^session/');
    }
  });

  it('keeps the moon out of the palette, which has no row to put to sleep', () => {
    const palette = manifest.contributes.menus['commandPalette']!.find((m) => m.command === 'kohVibe.sleepSession');
    expect(palette?.when).toBe('false');
  });

  it('puts Routines right after Processes, folded until someone opens it', () => {
    expect(viewIds().indexOf('kohVibe.routines')).toBe(viewIds().indexOf('kohVibe.processes') + 1);
    const view = manifest.contributes.views['koh-vibe']!.find((v) => v.id === 'kohVibe.routines');
    expect(view?.visibility).toBe('collapsed');
  });

  it('refreshes the routines from the title of their view, and from the palette', () => {
    const title = manifest.contributes.menus['view/title']!.find((m) => m.command === 'kohVibe.refreshRoutines');
    expect(title?.when).toBe('view == kohVibe.routines');
    expect(icon('kohVibe.refreshRoutines')).toBe('$(refresh)');
    expect(palette('kohVibe.refreshRoutines')).toBeUndefined();
  });

  it('copies the link of any routine row, and keeps the row commands out of the palette', () => {
    expect(context('kohVibe.copyRoutineLink').map((m) => m.when)).toEqual([
      'view == kohVibe.routines && viewItem =~ /^routine/',
    ]);
    for (const command of ['kohVibe.openRoutine', 'kohVibe.copyRoutineLink']) {
      expect(palette(command)?.when).toBe('false');
    }
  });

  it('puts Run now and Pause on an active routine, Resume on a paused one, nothing on a spent one-shot', () => {
    expect(inline('kohVibe.runRoutine').map((m) => m.when)).toEqual(['view == kohVibe.routines && viewItem == routine.enabled']);
    expect(inline('kohVibe.pauseRoutine').map((m) => m.when)).toEqual(['view == kohVibe.routines && viewItem == routine.enabled']);
    expect(inline('kohVibe.resumeRoutine').map((m) => m.when)).toEqual(['view == kohVibe.routines && viewItem == routine.paused']);
    expect(icon('kohVibe.runRoutine')).toBe('$(play)');
    expect(icon('kohVibe.pauseRoutine')).toBe('$(debug-pause)');
    expect(icon('kohVibe.resumeRoutine')).toBe('$(debug-start)');
  });

  it('puts the run first, in the order the row reads', () => {
    expect(inline('kohVibe.runRoutine')[0]?.group).toBe('inline@1');
    expect(inline('kohVibe.pauseRoutine')[0]?.group).toBe('inline@2');
    expect(inline('kohVibe.resumeRoutine')[0]?.group).toBe('inline@2');
  });

  it('keeps the three routine actions out of the palette, which has no row to act on', () => {
    for (const command of ['kohVibe.runRoutine', 'kohVibe.pauseRoutine', 'kohVibe.resumeRoutine']) {
      expect(palette(command)?.when).toBe('false');
    }
  });

  it('puts Artifacts right after Routines, folded until someone opens it', () => {
    expect(viewIds().indexOf('kohVibe.artifacts')).toBe(viewIds().indexOf('kohVibe.routines') + 1);
    const view = manifest.contributes.views['koh-vibe']!.find((v) => v.id === 'kohVibe.artifacts');
    expect(view?.visibility).toBe('collapsed');
  });

  it('refreshes the artifacts from the title of their view, and copies the link of any row', () => {
    const title = manifest.contributes.menus['view/title']!.find((m) => m.command === 'kohVibe.refreshArtifacts');
    expect(title?.when).toBe('view == kohVibe.artifacts');
    expect(icon('kohVibe.refreshArtifacts')).toBe('$(refresh)');
    expect(context('kohVibe.copyArtifactLink').map((m) => m.when)).toEqual([
      'view == kohVibe.artifacts && viewItem =~ /^artifact/',
    ]);
    for (const command of ['kohVibe.openArtifact', 'kohVibe.copyArtifactLink']) {
      expect(palette(command)?.when).toBe('false');
    }
  });

  it('offers Rename on every artifact row, from the right-click menu only', () => {
    expect(context('kohVibe.renameArtifact').map((m) => m.when)).toEqual(['view == kohVibe.artifacts && viewItem =~ /^artifact/']);
    expect(inline('kohVibe.renameArtifact')).toEqual([]);
    expect(palette('kohVibe.renameArtifact')?.when).toBe('false');
  });

  it('puts a pin at the right of an unpinned artifact, and an unpin on a pinned one', () => {
    expect(inline('kohVibe.pinArtifact').map((m) => m.when)).toEqual(['view == kohVibe.artifacts && viewItem == artifact.unpinned']);
    expect(inline('kohVibe.unpinArtifact').map((m) => m.when)).toEqual(['view == kohVibe.artifacts && viewItem == artifact.pinned']);
    expect(icon('kohVibe.pinArtifact')).toBe('$(pin)');
    expect(icon('kohVibe.unpinArtifact')).toBe('$(pinned)');
    for (const command of ['kohVibe.pinArtifact', 'kohVibe.unpinArtifact']) expect(palette(command)?.when).toBe('false');
  });
});
