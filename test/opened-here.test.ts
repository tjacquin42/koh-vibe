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

  // La PREMIÈRE conversation vue après la demande est celle d où l on vient :
  // au moment du clic, l onglet actif est encore le précédent. Elle ne ferme
  // donc pas l attente — seule une conversation de plus le fait. Le détail est
  // vérifié plus bas, avec le défaut qu il corrige.
  it('ne referme pas l attente sur la conversation d où l on vient', () => {
    const m = new OpenedHere();
    m.opening('s-nouvelle', 0);
    expect(m.observe('s-autre', tab('#EDN monitoring', 15), 100)).toBe('s-autre');
    expect(m.observe(undefined, tab('Claude Code'), 200)).toBe('s-nouvelle');
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

// Le défaut qui restait : au moment de la demande, l onglet actif est encore
// celui d avant — souvent une AUTRE conversation. La règle « il est passé à
// autre chose » se déclenchait dessus et jetait l attente avant même que le
// panneau demandé n apparaisse.
describe('OpenedHere — la conversation quittée ne compte pas comme un changement d avis', () => {
  it('garde l attente quand l onglet encore actif est celui d où l on vient', () => {
    const m = new OpenedHere();
    m.opening('s-nouvelle', 0);
    // Premier événement : on est toujours sur la conversation précédente.
    expect(m.observe('s-precedente', tab('#EDN monitoring', 15), 20)).toBe('s-precedente');
    // Le panneau demandé arrive enfin, et rien ne sait encore le nommer.
    expect(m.observe(undefined, tab('Claude Code'), 30)).toBe('s-nouvelle');
    expect(m.entries()).toEqual([{ sessionId: 's-nouvelle', title: 'Claude Code', group: 0, index: 16 }]);
  });

  it('revenir sur la conversation quittée ne ferme toujours pas l attente', () => {
    const m = new OpenedHere();
    m.opening('s-nouvelle', 0);
    m.observe('s-precedente', tab('#EDN monitoring', 15), 20);
    expect(m.observe('s-precedente', tab('#EDN monitoring', 15), 40)).toBe('s-precedente');
    expect(m.observe(undefined, tab('Claude Code'), 50)).toBe('s-nouvelle');
  });

  it('mais une TROISIÈME conversation, elle, ferme bien l attente', () => {
    const m = new OpenedHere();
    m.opening('s-nouvelle', 0);
    m.observe('s-precedente', tab('#EDN monitoring', 15), 20);
    expect(m.observe('s-tierce', tab('Autre chose', 9), 30)).toBe('s-tierce');
    expect(m.observe(undefined, tab('Claude Code'), 40)).toBeUndefined();
    expect(m.entries()).toEqual([]);
  });
});
