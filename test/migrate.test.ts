import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrateLegacyHome } from '../src/store/migrate';
import { legacyHome, kohVibeHome } from '../src/paths';

let root: string;
const legacy = (): string => join(root, '.koh-claude');
const home = (): string => join(root, '.koh-vibe');

const seed = (dir: string, marker: string): void => {
  mkdirSync(join(dir, 'sessions'), { recursive: true });
  writeFileSync(join(dir, 'groups.json'), marker, 'utf8');
};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'koh-mig-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('migrateLegacyHome', () => {
  it('takes over the state of the old name when the new one does not exist', async () => {
    seed(legacy(), 'mon classement');
    expect(await migrateLegacyHome(legacy(), home())).toBe('migrated');
    expect(readFileSync(join(home(), 'groups.json'), 'utf8')).toBe('mon classement');
    expect(existsSync(join(home(), 'sessions'))).toBe(true);
    expect(existsSync(legacy())).toBe(false);
  });

  it('touches nothing when the new state already exists — it is the authority', async () => {
    seed(legacy(), 'ancien');
    seed(home(), 'récent');
    expect(await migrateLegacyHome(legacy(), home())).toBe('nothing');
    expect(readFileSync(join(home(), 'groups.json'), 'utf8')).toBe('récent');
    // L ancien reste en place : à l utilisateur de le supprimer s il le veut.
    expect(existsSync(legacy())).toBe(true);
  });

  it('does nothing when there is nothing to take over', async () => {
    expect(await migrateLegacyHome(legacy(), home())).toBe('nothing');
    expect(existsSync(home())).toBe(false);
  });

  it('does not move onto itself when both roots coincide', async () => {
    seed(home(), 'inchangé');
    expect(await migrateLegacyHome(home(), home())).toBe('nothing');
    expect(readFileSync(join(home(), 'groups.json'), 'utf8')).toBe('inchangé');
  });
});

describe('legacyHome', () => {
  it('points at the old folder', () => {
    expect(legacyHome({ HOME: '/Users/dev' })).toBe('/Users/dev/.koh-claude');
    expect(kohVibeHome({ HOME: '/Users/dev' })).toBe('/Users/dev/.koh-vibe');
  });

  it('follows its own isolation setting, so a test never targets the real folder', () => {
    expect(legacyHome({ HOME: '/Users/dev', KOH_VIBE_LEGACY_HOME: '/tmp/faux' })).toBe('/tmp/faux');
  });
});
