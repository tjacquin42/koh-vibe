import { describe, expect, it } from 'vitest';
import { colorChoice, GROUP_COLORS, NO_COLOR_LABEL, shownColor, themeColorOf } from '../src/ui/colors';

describe('palette', () => {
  it('exposes theme colours only, never a hard-coded code', () => {
    // Deux familles enregistrées par VSCode, et rien d'autre : un « #4FC3D9 »
    // resterait le même sous un thème clair, un sombre et un tiers — c'est
    // précisément ce que la palette existe pour éviter.
    for (const c of GROUP_COLORS) expect(c.theme).toMatch(/^(charts|terminal\.ansi)/);
    for (const c of GROUP_COLORS) expect(c.theme).not.toMatch(/#/);
  });

  it('never offers the same colour twice under two names', () => {
    // Deux entrées de la liste qui donneraient le même bleu : le choix
    // paraîtrait fait alors que rien n'aurait changé.
    expect(new Set(GROUP_COLORS.map((c) => c.theme)).size).toBe(GROUP_COLORS.length);
  });

  it('keeps the ids already written into groups.json', () => {
    // Le fichier est partagé et déjà rempli : retirer ou renommer l'un de ces
    // six ferait perdre sa couleur à un dossier existant, en silence.
    for (const id of ['blue', 'green', 'yellow', 'orange', 'red', 'purple']) {
      expect(GROUP_COLORS.some((c) => c.id === id)).toBe(true);
    }
  });

  it('carries ids and labels that are all distinct', () => {
    expect(new Set(GROUP_COLORS.map((c) => c.id)).size).toBe(GROUP_COLORS.length);
    expect(new Set(GROUP_COLORS.map((c) => c.label)).size).toBe(GROUP_COLORS.length);
  });

  it('never uses the "None" label for a real colour', () => {
    expect(GROUP_COLORS.some((c) => c.label === NO_COLOR_LABEL)).toBe(false);
  });
});

describe('themeColorOf', () => {
  it('turns a known id into a theme colour', () => {
    expect(themeColorOf('blue')).toBe('charts.blue');
  });

  it('shows what it does not know without a colour, rather than breaking the view', () => {
    expect(themeColorOf('turquoise')).toBeUndefined();
    expect(themeColorOf('')).toBeUndefined();
    expect(themeColorOf(undefined)).toBeUndefined();
  });
});

describe('colorChoice', () => {
  it('sets the chosen colour', () => {
    expect(colorChoice('Blue')).toEqual({ kind: 'set', color: 'blue' });
  });

  it('removes the colour on "None" — that is a choice, not an absence', () => {
    expect(colorChoice(NO_COLOR_LABEL)).toEqual({ kind: 'set', color: undefined });
  });

  it('touches nothing when the list is closed without choosing', () => {
    expect(colorChoice(undefined)).toEqual({ kind: 'cancel' });
  });

  it('cancels rather than erases when the label is unknown', () => {
    // Le pire résultat possible serait un effacement silencieux : fermer et
    // choisir n'importe quoi ne doivent jamais retirer une couleur par accident.
    expect(colorChoice('Turquoise')).toEqual({ kind: 'cancel' });
    expect(colorChoice('')).toEqual({ kind: 'cancel' });
  });
});

describe('shownColor', () => {
  const group = { id: 'g1', color: 'blue' };

  it('shows the folder colour when no preview is running', () => {
    expect(shownColor(group, undefined)).toBe('blue');
  });

  it('shows the preview on the folder it targets', () => {
    expect(shownColor(group, { groupId: 'g1', color: 'red' })).toBe('red');
  });

  it('leaves the OTHER folders alone', () => {
    // On ne choisit que pour un dossier à la fois : voir toute la vue changer
    // pendant qu'on parcourt la liste dirait le contraire de ce qui se passe.
    expect(shownColor(group, { groupId: 'g2', color: 'red' })).toBe('blue');
  });

  it('can preview "no colour", without confusing it with the absence of a preview', () => {
    // La distinction qui compte : parcourir « Aucune » doit décolorer le
    // dossier pour de vrai, sinon on valide sans avoir vu le résultat.
    expect(shownColor(group, { groupId: 'g1', color: undefined })).toBeUndefined();
    expect(shownColor(group, undefined)).toBe('blue');
  });

  it('does not colour "Unfiled", which carries no choice', () => {
    expect(shownColor(undefined, { groupId: 'g1', color: 'red' })).toBeUndefined();
    expect(shownColor(undefined, undefined)).toBeUndefined();
  });
});
