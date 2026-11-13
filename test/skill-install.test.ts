import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { claudeSkillsDir, declineSkill, installSkill, refreshSkill, replaceSkill, uninstallSkill, type SkillPaths } from '../src/skill/install';

let root: string;
let p: SkillPaths;

const write = (dir: string, files: Record<string, string>): void => {
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(join(dir, rel, '..'), { recursive: true });
    writeFileSync(join(dir, rel), text);
  }
};
const read = (rel: string): string => readFileSync(join(p.target, rel), 'utf8');

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'koh-skill-'));
  p = { source: join(root, 'ext', 'skill', 'koh-vibe'), target: join(root, 'claude', 'skills', 'koh-vibe'), marker: join(root, 'koh', 'skill.json'), backups: join(root, 'koh', 'backups') };
  write(p.source, { 'SKILL.md': 'v1', 'references/files.md': 'files v1' });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('installSkill — the gesture that says yes', () => {
  it('copies the skill, references included, and remembers what it wrote', () => {
    expect(installSkill(p)).toBe('installed');
    expect(read('SKILL.md')).toBe('v1');
    expect(read('references/files.md')).toBe('files v1');
    expect(existsSync(p.marker)).toBe(true);
  });

  it('is idempotent', () => {
    installSkill(p);
    expect(installSkill(p)).toBe('unchanged');
  });

  it('brings an untouched copy up to date, and drops the files the new version no longer has', () => {
    installSkill(p);
    rmSync(p.source, { recursive: true });
    write(p.source, { 'SKILL.md': 'v2' });
    expect(installSkill(p)).toBe('updated');
    expect(read('SKILL.md')).toBe('v2');
    expect(existsSync(join(p.target, 'references'))).toBe(false);
  });

  it('never overwrites a copy edited by hand', () => {
    installSkill(p);
    writeFileSync(join(p.target, 'SKILL.md'), 'my notes');
    write(p.source, { 'SKILL.md': 'v2' });
    expect(installSkill(p)).toBe('edited');
    expect(read('SKILL.md')).toBe('my notes');
  });

  it('never overwrites a skill of that name it did not write', () => {
    write(p.target, { 'SKILL.md': 'someone else' });
    expect(installSkill(p)).toBe('edited');
    expect(read('SKILL.md')).toBe('someone else');
  });
});

describe('refreshSkill — what each start of the extension does', () => {
  it('writes nothing where the skill was never installed: that takes a yes', () => {
    expect(refreshSkill(p)).toBe('absent');
    expect(existsSync(p.target)).toBe(false);
  });

  it('follows the new version of an installed skill', () => {
    installSkill(p);
    write(p.source, { 'SKILL.md': 'v2' });
    expect(refreshSkill(p)).toBe('updated');
    expect(read('SKILL.md')).toBe('v2');
  });

  it('leaves an edited copy alone', () => {
    installSkill(p);
    writeFileSync(join(p.target, 'SKILL.md'), 'my notes');
    write(p.source, { 'SKILL.md': 'v2' });
    expect(refreshSkill(p)).toBe('edited');
  });

  it('says « edited » only when there is something new to install', () => {
    installSkill(p);
    writeFileSync(join(p.target, 'SKILL.md'), 'my notes');
    expect(refreshSkill(p)).toBe('unchanged');
  });

  it('takes a skill deleted by hand as a no: never puts it back on its own', () => {
    installSkill(p);
    rmSync(p.target, { recursive: true });
    write(p.source, { 'SKILL.md': 'v2' });
    expect(refreshSkill(p)).toBe('absent');
    expect(existsSync(p.target)).toBe(false);
    expect(refreshSkill(p)).toBe('absent');
  });
});

describe('replaceSkill — the answer to « edited »', () => {
  it('keeps the edited copy in the backups, then installs', () => {
    installSkill(p);
    writeFileSync(join(p.target, 'SKILL.md'), 'my notes');
    write(p.source, { 'SKILL.md': 'v2' });
    const backup = replaceSkill(p, () => 42);
    expect(read('SKILL.md')).toBe('v2');
    expect(backup).toBe(join(p.backups, 'skill-koh-vibe-42'));
    expect(readFileSync(join(backup!, 'SKILL.md'), 'utf8')).toBe('my notes');
    expect(refreshSkill(p)).toBe('unchanged');
  });
});

describe('declineSkill — « keep mine »', () => {
  it('is asked once per version: the same version is not offered again, the next one is', () => {
    installSkill(p);
    writeFileSync(join(p.target, 'SKILL.md'), 'my notes');
    write(p.source, { 'SKILL.md': 'v2' });
    declineSkill(p);
    expect(refreshSkill(p)).toBe('unchanged');
    expect(read('SKILL.md')).toBe('my notes');
    write(p.source, { 'SKILL.md': 'v3' });
    expect(refreshSkill(p)).toBe('edited');
  });

  it('is forgotten by an explicit install, which writes a fresh marker', () => {
    installSkill(p);
    writeFileSync(join(p.target, 'SKILL.md'), 'my notes');
    write(p.source, { 'SKILL.md': 'v2' });
    declineSkill(p);
    replaceSkill(p, () => 1);
    writeFileSync(join(p.target, 'SKILL.md'), 'my notes again');
    write(p.source, { 'SKILL.md': 'v3' });
    expect(refreshSkill(p)).toBe('edited');
  });
});

describe('uninstallSkill', () => {
  it('removes the copy it wrote, and forgets it', () => {
    installSkill(p);
    expect(uninstallSkill(p)).toBe('removed');
    expect(existsSync(p.target)).toBe(false);
    expect(refreshSkill(p)).toBe('absent');
  });

  it('leaves an edited copy in place, but stops updating it', () => {
    installSkill(p);
    writeFileSync(join(p.target, 'SKILL.md'), 'my notes');
    expect(uninstallSkill(p)).toBe('edited');
    expect(read('SKILL.md')).toBe('my notes');
    expect(refreshSkill(p)).toBe('absent');
  });

  it('has nothing to do where nothing was installed', () => {
    expect(uninstallSkill(p)).toBe('absent');
  });

  it('leaves no temporary folder behind', () => {
    installSkill(p);
    write(p.source, { 'SKILL.md': 'v2' });
    installSkill(p);
    expect(readdirSync(join(p.target, '..'))).toEqual(['koh-vibe']);
  });
});

describe('claudeSkillsDir', () => {
  it('follows CLAUDE_CONFIG_DIR, as Claude Code does', () => {
    expect(claudeSkillsDir({ HOME: '/Users/dev' })).toBe('/Users/dev/.claude/skills');
    expect(claudeSkillsDir({ HOME: '/Users/dev', CLAUDE_CONFIG_DIR: '/Users/dev/alt' })).toBe('/Users/dev/alt/skills');
    expect(claudeSkillsDir({ HOME: '/Users/dev', CLAUDE_CONFIG_DIR: '' })).toBe('/Users/dev/.claude/skills');
  });
});

describe('the skill shipped with the extension', () => {
  const shipped = join(__dirname, '..', 'skill', 'koh-vibe');

  it('is named after its folder, as Claude Code requires', () => {
    const head = readFileSync(join(shipped, 'SKILL.md'), 'utf8').split('\n---\n')[0]!;
    expect(head).toMatch(/^---\nname: koh-vibe\ndescription: .{100,}/s);
  });

  it('is in the package', () => {
    expect(readFileSync(join(__dirname, '..', '.vscodeignore'), 'utf8')).toMatch(/^!skill\/\*\*$/m);
  });
});
