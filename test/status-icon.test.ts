import { describe, expect, it } from 'vitest';
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import type { Status } from '../src/events/types';
import { STATUS_ICON_DIR, statusIconPath } from '../src/ui/status-icon';

const ALL: readonly Status[] = ['running', 'waiting', 'done_unseen', 'idle', 'stale'];
const ROOT = join(__dirname, '..');

describe('statusIconPath', () => {
  it('gives every status a light/dark pair, with no exception', () => {
    for (const status of ALL) {
      const paths = statusIconPath('/ext', status);
      expect(paths.light, `statut ${status}`).toMatch(/\.svg$/);
      expect(paths.dark, `statut ${status}`).toMatch(/\.svg$/);
      expect(paths.light, `statut ${status}`).not.toBe(paths.dark);
    }
  });

  it('never gives the same file to two different statuses', () => {
    const seen = ALL.flatMap((s) => Object.values(statusIconPath('/ext', s)));
    expect(new Set(seen).size).toBe(seen.length);
  });

  it('sits under the package root it is given', () => {
    expect(statusIconPath('/ext', 'running').dark.startsWith(join('/ext', 'resources', STATUS_ICON_DIR))).toBe(true);
  });

  // Le test qui compte vraiment : une table qui nomme un fichier absent produit
  // une ligne SANS icône, et la pastille est le seul endroit où le statut se lit.
  // Un statut ajouté sans repasser par scripts/make-status-icons.cjs doit se
  // voir ici, pas dans la barre latérale de l utilisateur.
  it('names files that really exist in the package', async () => {
    for (const status of ALL) {
      const paths = statusIconPath(ROOT, status);
      for (const file of [paths.light, paths.dark]) {
        await expect(access(file), `${status} → ${file}`).resolves.toBeUndefined();
      }
    }
  });
});
