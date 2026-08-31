import { describe, expect, it } from 'vitest';
import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Status } from '../src/events/types';
import { STATUS_ICON_DIR, STILL_ICON_DIR, statusIconPath } from '../src/ui/status-icon';

const ALL: readonly Status[] = ['running', 'waiting', 'done_unseen', 'idle'];
const ROOT = join(__dirname, '..');

describe('statusIconPath', () => {
  it('donne une paire light/dark à chaque statut, sans exception', () => {
    for (const status of ALL) {
      const paths = statusIconPath('/ext', status);
      expect(paths.light, `statut ${status}`).toMatch(/\.svg$/);
      expect(paths.dark, `statut ${status}`).toMatch(/\.svg$/);
      expect(paths.light, `statut ${status}`).not.toBe(paths.dark);
    }
  });

  it('ne donne jamais le même fichier à deux statuts différents', () => {
    const seen = ALL.flatMap((s) => Object.values(statusIconPath('/ext', s)));
    expect(new Set(seen).size).toBe(seen.length);
  });

  it('se range sous la racine du paquet qu on lui donne', () => {
    expect(statusIconPath('/ext', 'running').dark.startsWith(join('/ext', 'resources', STATUS_ICON_DIR))).toBe(true);
  });

  // Le test qui compte vraiment : une table qui nomme un fichier absent produit
  // une ligne SANS icône, et la pastille est le seul endroit où le statut se lit.
  // Un statut ajouté sans repasser par scripts/make-status-icons.cjs doit se
  // voir ici, pas dans la barre latérale de l utilisateur.
  it('nomme des fichiers qui existent réellement dans le paquet', async () => {
    for (const status of ALL) {
      const paths = statusIconPath(ROOT, status);
      for (const file of [paths.light, paths.dark]) {
        await expect(access(file), `${status} → ${file}`).resolves.toBeUndefined();
      }
    }
  });
});

const TONES = [...ALL, 'ended'] as const;

describe('statusIconPath — le jeu figé, quand on coupe les animations', () => {
  it('désigne le sous-dossier des immobiles, et lui seul', () => {
    const still = statusIconPath('/ext', 'running', false);
    expect(still.dark.startsWith(join('/ext', 'resources', STATUS_ICON_DIR, STILL_ICON_DIR))).toBe(true);
    expect(statusIconPath('/ext', 'running', true).dark).not.toContain(STILL_ICON_DIR);
  });

  it('anime par défaut : un appelant qui ne dit rien garde le mouvement', () => {
    expect(statusIconPath('/ext', 'running').dark).toBe(statusIconPath('/ext', 'running', true).dark);
  });

  // Le même invariant que ci-dessus, pour le second jeu : une case décochée ne
  // doit pas produire des lignes SANS pastille.
  it('nomme des fichiers qui existent vraiment, pour chaque ton', async () => {
    for (const tone of TONES) {
      const paths = statusIconPath(ROOT, tone, false);
      for (const file of [paths.light, paths.dark]) {
        await expect(access(file), `${tone} → ${file}`).resolves.toBeUndefined();
      }
    }
  });

  it('ne porte aucune animation, là où le jeu animé en porte une', async () => {
    // La vraie garantie derrière la case : décochée, plus rien ne bouge.
    for (const tone of TONES) {
      const still = await readFile(statusIconPath(ROOT, tone, false).dark, 'utf8');
      expect(still, `${tone} figé`).not.toContain('animation:');
    }
    // Et le mouvement existe bel et bien quelque part, sinon le test au-dessus
    // passerait tout seul le jour où l animation disparaîtrait par accident.
    const moving = await Promise.all(
      TONES.map((t) => readFile(statusIconPath(ROOT, t, true).dark, 'utf8')),
    );
    expect(moving.some((svg) => svg.includes('animation:'))).toBe(true);
  });

  it('dessine la MÊME chose, au mouvement près — sinon couper l animation changerait le sens', async () => {
    // Les deux fichiers doivent parler des mêmes formes : mêmes rayons, mêmes
    // couleurs, même pointillé. Seuls le bloc <style> et l angle de départ,
    // porté par un attribut d un côté et par les keyframes de l autre, varient.
    for (const tone of TONES) {
      const strip = (svg: string): string =>
        svg.replace(/<style>[\s\S]*?<\/style>/, '')
          .replace(/ class="r"/, '')
          .replace(/ transform="rotate\(-90 8 8\)"/, '');
      const [moving, still] = await Promise.all([
        readFile(statusIconPath(ROOT, tone, true).dark, 'utf8').then(strip),
        readFile(statusIconPath(ROOT, tone, false).dark, 'utf8').then(strip),
      ]);
      expect(still, `${tone}`).toBe(moving);
    }
  });
});
