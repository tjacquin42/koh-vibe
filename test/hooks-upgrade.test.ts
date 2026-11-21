import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { countKohEntries, installHooks } from '../src/hooks/installer';
import { upgradeInstalledHooks } from '../src/hooks/upgrade';

const BRIDGE = '/Users/dev/.koh-vibe/bin/koh-vibe-bridge';
let dir = '';
let settings = '';
let backups = '';

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'kv-upgrade-'));
  settings = join(dir, 'settings.json');
  backups = join(dir, 'backups');
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** Our hooks as an older version installed them: without PostToolUseFailure. */
function older(): unknown {
  const all = installHooks({ model: 'opus', statusLine: { type: 'command', command: 'mine' } }, BRIDGE) as { hooks: Record<string, unknown> };
  const { PostToolUseFailure: _gone, ...hooks } = all.hooks;
  return { ...all, hooks };
}

describe('upgradeInstalledHooks (21/11)', () => {
  it('adds the missing event, saves the file in the backups first, and keeps its indentation and the status line', async () => {
    await writeFile(settings, `${JSON.stringify(older(), null, 4)}\n`);
    expect(await upgradeInstalledHooks(settings, backups, 42)).toBe(true);
    const raw = await readFile(settings, 'utf8');
    expect(raw.startsWith('{\n    "')).toBe(true);
    const after: unknown = JSON.parse(raw);
    expect(countKohEntries(after)).toBe(9);
    expect((after as { statusLine: unknown }).statusLine).toEqual({ type: 'command', command: 'mine' });
    expect(await readdir(backups)).toEqual(['settings-42.json']);
    expect(await readdir(dir)).toEqual(['backups', 'settings.json']);
    // Up to date now: a second start writes nothing.
    expect(await upgradeInstalledHooks(settings, backups, 43)).toBe(false);
  });

  it('writes nothing when the hooks are not installed, or the file is missing or broken', async () => {
    await writeFile(settings, '{"model":"opus"}');
    expect(await upgradeInstalledHooks(settings, backups)).toBe(false);
    expect(await readFile(settings, 'utf8')).toBe('{"model":"opus"}');
    await writeFile(settings, '{oops');
    expect(await upgradeInstalledHooks(settings, backups)).toBe(false);
    expect(await upgradeInstalledHooks(join(dir, 'none.json'), backups)).toBe(false);
    await expect(readdir(backups)).rejects.toThrow();
  });
});
