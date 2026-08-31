import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// The contribution points VSCode reads from package.json, typed to what these
// tests look at. A menu entry that goes missing fails silently at runtime —
// the button is simply not there — which is why it is asserted here.
type Command = { command: string; icon?: string | { light: string; dark: string } };
type MenuEntry = { command: string; when?: string; group?: string };
type Manifest = { contributes: { commands: Command[]; menus: Record<string, MenuEntry[]> } };

const manifest = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8')) as Manifest;
const inline = (command: string): MenuEntry[] =>
  manifest.contributes.menus['view/item/context']!.filter((m) => m.command === command && (m.group ?? '').startsWith('inline'));
const context = (command: string): MenuEntry[] =>
  manifest.contributes.menus['view/item/context']!.filter((m) => m.command === command);
const icon = (command: string): Command['icon'] => manifest.contributes.commands.find((c) => c.command === command)?.icon;

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
});
