import { describe, expect, it } from 'vitest';
import { colorChoice, GROUP_COLORS, NO_COLOR_LABEL, shownColor, themeColorOf } from '../src/ui/colors';

describe('palette', () => {
  it('n\'expose que des couleurs de thème, jamais un code en dur', () => {
    // Deux familles enregistrées par VSCode, et rien d'autre : un « #4FC3D9 »
    // resterait le même sous un thème clair, un sombre et un tiers — c'est
    // précisément ce que la palette existe pour éviter.
    for (const c of GROUP_COLORS) expect(c.theme).toMatch(/^(charts|terminal\.ansi)/);
    for (const c of GROUP_COLORS) expect(c.theme).not.toMatch(/#/);
  });

  it('ne propose pas deux fois la même couleur sous deux noms', () => {
    // Deux entrées de la liste qui donneraient le même bleu : le choix
    // paraîtrait fait alors que rien n'aurait changé.
    expect(new Set(GROUP_COLORS.map((c) => c.theme)).size).toBe(GROUP_COLORS.length);
  });

  it('garde les identifiants déjà écrits dans groups.json', () => {
    // Le fichier est partagé et déjà rempli : retirer ou renommer l'un de ces
    // six ferait perdre sa couleur à un dossier existant, en silence.
    for (const id of ['blue', 'green', 'yellow', 'orange', 'red', 'purple']) {
      expect(GROUP_COLORS.some((c) => c.id === id)).toBe(true);
    }
  });

  it('porte des identifiants et des libellés tous distincts', () => {
    expect(new Set(GROUP_COLORS.map((c) => c.id)).size).toBe(GROUP_COLORS.length);
    expect(new Set(GROUP_COLORS.map((c) => c.label)).size).toBe(GROUP_COLORS.length);
  });

  it('n\'utilise pas le libellé « Aucune » pour une vraie couleur', () => {
    expect(GROUP_COLORS.some((c) => c.label === NO_COLOR_LABEL)).toBe(false);
  });
});

describe('themeColorOf', () => {
  it('traduit un identifiant connu en couleur de thème', () => {
    expect(themeColorOf('blue')).toBe('charts.blue');
  });

  it('affiche sans couleur ce qu\'il ne connaît pas, plutôt que de casser la vue', () => {
    expect(themeColorOf('turquoise')).toBeUndefined();
    expect(themeColorOf('')).toBeUndefined();
    expect(themeColorOf(undefined)).toBeUndefined();
  });
});

describe('colorChoice', () => {
  it('pose la couleur choisie', () => {
    expect(colorChoice('Blue')).toEqual({ kind: 'set', color: 'blue' });
  });

  it('retire la couleur sur « Aucune » — c\'est un choix, pas une absence', () => {
    expect(colorChoice(NO_COLOR_LABEL)).toEqual({ kind: 'set', color: undefined });
  });

  it('ne touche à rien quand la liste est fermée sans choisir', () => {
    expect(colorChoice(undefined)).toEqual({ kind: 'cancel' });
  });

  it('annule plutôt que d\'effacer devant un libellé inconnu', () => {
    // Le pire résultat possible serait un effacement silencieux : fermer et
    // choisir n'importe quoi ne doivent jamais retirer une couleur par accident.
    expect(colorChoice('Turquoise')).toEqual({ kind: 'cancel' });
    expect(colorChoice('')).toEqual({ kind: 'cancel' });
  });
});

describe('shownColor', () => {
  const group = { id: 'g1', color: 'blue' };

  it('affiche la couleur du dossier quand aucun aperçu ne court', () => {
    expect(shownColor(group, undefined)).toBe('blue');
  });

  it('affiche l\'aperçu sur le dossier qu\'il vise', () => {
    expect(shownColor(group, { groupId: 'g1', color: 'red' })).toBe('red');
  });

  it('laisse les AUTRES dossiers tranquilles', () => {
    // On ne choisit que pour un dossier à la fois : voir toute la vue changer
    // pendant qu'on parcourt la liste dirait le contraire de ce qui se passe.
    expect(shownColor(group, { groupId: 'g2', color: 'red' })).toBe('blue');
  });

  it('sait montrer « aucune couleur » en aperçu, sans la confondre avec l\'absence d\'aperçu', () => {
    // La distinction qui compte : parcourir « Aucune » doit décolorer le
    // dossier pour de vrai, sinon on valide sans avoir vu le résultat.
    expect(shownColor(group, { groupId: 'g1', color: undefined })).toBeUndefined();
    expect(shownColor(group, undefined)).toBe('blue');
  });

  it('ne colore pas « Sans dossier », qui ne porte aucun choix', () => {
    expect(shownColor(undefined, { groupId: 'g1', color: 'red' })).toBeUndefined();
    expect(shownColor(undefined, undefined)).toBeUndefined();
  });
});
