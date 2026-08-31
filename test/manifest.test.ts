import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// The contribution points VSCode reads from package.json, typed to what these
// tests look at. A menu entry that goes missing fails silently at runtime —
// the button is simply not there — which is why it is asserted here.
type Command = { command: string; icon?: string };
type MenuEntry = { command: string; when?: string; group?: string };
type Manifest = { contributes: { commands: Command[]; menus: Record<string, MenuEntry[]> } };

const manifest = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8')) as Manifest;
const inline = (command: string): MenuEntry[] =>
  manifest.contributes.menus['view/item/context']!.filter((m) => m.command === command && m.group === 'inline');
const context = (command: string): MenuEntry[] =>
  manifest.contributes.menus['view/item/context']!.filter((m) => m.command === command);
const icon = (command: string): string | undefined => manifest.contributes.commands.find((c) => c.command === command)?.icon;

describe('the manifest', () => {
  it('puts a + at the right of every folder row, temporary sessions included, with the same icon as the view title', () => {
    const [entry] = inline('kohVibe.newSessionInGroup');
    expect(entry?.when).toContain('viewItem == group');
    expect(entry?.when).toContain('viewItem == unfiled');
    expect(icon('kohVibe.newSessionInGroup')).toBe(icon('kohVibe.newSession'));
    expect(icon('kohVibe.newSession')).toBe('$(add)');
  });

  it('keeps the trash at the right of a session row', () => {
    const [entry] = inline('kohVibe.closeSession');
    expect(entry?.when).toContain('viewItem == session');
    expect(icon('kohVibe.closeSession')).toBe('$(trash)');
  });

  it('offers the id of a conversation on a live row and on a closed one', () => {
    const whens = context('kohVibe.copySessionId').map((m) => m.when ?? '');
    expect(whens.some((w) => w.includes('viewItem == session'))).toBe(true);
    expect(whens.some((w) => w.includes('viewItem == closedSession'))).toBe(true);
  });

  it('keeps that copy out of the palette, which has no row to read an id from', () => {
    const palette = manifest.contributes.menus['commandPalette']!.find((m) => m.command === 'kohVibe.copySessionId');
    expect(palette?.when).toBe('false');
  });
});
