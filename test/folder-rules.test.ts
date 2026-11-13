import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { addRulePrompt, ensureRulesFile, RULES_SKILL } from '../src/groups/rules';
import { folderRulesFile } from '../src/paths';

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'koh-folder-rules-'));
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe('folderRulesFile', () => {
  it('keeps a folder’s rules under its id, so that a rename keeps them', () => {
    expect(folderRulesFile('/h', 'g-1')).toBe('/h/rules/g-1.md');
  });
});

describe('ensureRulesFile', () => {
  it('creates the file with its folder named, and only the first time', async () => {
    const path = await ensureRulesFile(home, 'g-video', 'VIDEO');
    expect(readFileSync(path, 'utf8')).toBe('---\nfolder: VIDEO\n---\n\n');
    writeFileSync(path, '---\nfolder: VIDEO\n---\nMine.\n');
    await ensureRulesFile(home, 'g-video', 'VIDEO');
    expect(readFileSync(path, 'utf8')).toContain('Mine.');
  });

  it('works when the rules folder already exists', async () => {
    mkdirSync(join(home, 'rules'));
    expect(await ensureRulesFile(home, 'g', 'X')).toBe(join(home, 'rules', 'g.md'));
  });
});

describe('addRulePrompt', () => {
  it('opens on a title, names the skill and the folder, and asks which rule to add', () => {
    const prompt = addRulePrompt('VIDEO', 'g-video');
    const [title] = prompt.split('\n');
    expect(title).toBe('Folder rule — VIDEO');
    expect(prompt).toContain(RULES_SKILL);
    expect(prompt).toContain('« VIDEO » (id g-video)');
    expect(prompt).toContain('Ask me which rule to add to this folder.');
  });
});
