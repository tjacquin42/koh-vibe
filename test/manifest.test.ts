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
});
