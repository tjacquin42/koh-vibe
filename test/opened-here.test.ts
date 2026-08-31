import { describe, expect, it } from 'vitest';
import { OpenedHere, PENDING_OPEN_MS } from '../src/claude/opened-here';

const tab = (title: string, index = 16) => ({ title, group: 0, index });

describe('OpenedHere — reconnaître l onglet qu on vient de faire ouvrir', () => {
  it('ne retient rien tant que rien n a été demandé', () => {
    const m = new OpenedHere();
    expect(m.observe(undefined, tab('Claude Code'), 0)).toBeUndefined();
    expect(m.entries()).toEqual([]);
  });

  // Le défaut observé : le premier événement arrive ~19 ms après la demande,
  // alors que l onglet actif est encore un fichier. Consommer l attente là
  // perdait l onglet qui arrivait 8 ms plus tard.
  it('garde l attente ouverte tant qu aucune conversation n est active', () => {
    const m = new OpenedHere();
    m.opening('s-nouvelle', 0);
    expect(m.observe(undefined, undefined, 19)).toBeUndefined();
    expect(m.entries()).toEqual([]);
    // L onglet arrive enfin.
    expect(m.observe(undefined, tab('Claude Code'), 27)).toBe('s-nouvelle');
    expect(m.entries()).toEqual([{ sessionId: 's-nouvelle', title: 'Claude Code', group: 0, index: 16 }]);
  });

  // Le second : le panneau s ouvre sous « Claude Code » puis prend son titre.
  it('ré-enregistre quand l onglet se renomme, plutôt que de garder une étiquette périmée', () => {
    const m = new OpenedHere();
    m.opening('s-nouvelle', 0);
    m.observe(undefined, tab('Claude Code'), 27);
    expect(m.observe(undefined, tab('Fiabilité IVECO moteur'), 640)).toBe('s-nouvelle');
    expect(m.entries()).toEqual([
      { sessionId: 's-nouvelle', title: 'Fiabilité IVECO moteur', group: 0, index: 16 },
    ]);
  });

  it('referme l attente dès qu une AUTRE conversation devient active', () => {
    const m = new OpenedHere();
    m.opening('s-nouvelle', 0);
    expect(m.observe('s-autre', tab('#EDN monitoring', 15), 100)).toBe('s-autre');
    expect(m.entries()).toEqual([]);
    // Ce qui suit ne doit plus être attribué à la conversation attendue.
    expect(m.observe(undefined, tab('Claude Code'), 200)).toBeUndefined();
  });

  it('laisse la résolution habituelle répondre quand elle nomme la conversation attendue', () => {
    const m = new OpenedHere();
    m.opening('s-nouvelle', 0);
    expect(m.observe('s-nouvelle', tab('Fiabilité IVECO moteur'), 900)).toBe('s-nouvelle');
  });

  it('abandonne passé le délai — l onglet actif n a plus de raison d être celui demandé', () => {
    const m = new OpenedHere();
    m.opening('s-nouvelle', 0);
    expect(m.observe(undefined, tab('Autre chose'), PENDING_OPEN_MS + 1)).toBeUndefined();
    expect(m.entries()).toEqual([]);
  });

  it('retient plusieurs conversations, chacune à sa place', () => {
    const m = new OpenedHere();
    m.opening('s-un', 0);
    m.observe(undefined, tab('Un', 3), 10);
    m.opening('s-deux', 100);
    m.observe(undefined, tab('Deux', 7), 110);
    expect(m.entries()).toEqual([
      { sessionId: 's-un', title: 'Un', group: 0, index: 3 },
      { sessionId: 's-deux', title: 'Deux', group: 0, index: 7 },
    ]);
  });
});
