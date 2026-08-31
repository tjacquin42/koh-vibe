import { describe, expect, it } from 'vitest';
import { OpenedHere, PENDING_OPEN_MS } from '../src/claude/opened-here';

const tab = (title: string, index = 16) => ({ title, group: 0, index });

describe('OpenedHere — recognising the tab just asked for', () => {
  it('remembers nothing while nothing has been asked for', () => {
    const m = new OpenedHere();
    expect(m.observe(undefined, tab('Claude Code'), 0)).toBeUndefined();
    expect(m.entries()).toEqual([]);
  });

  // Le défaut observé : le premier événement arrive ~19 ms après la demande,
  // alors que l onglet actif est encore un fichier. Consommer l attente là
  // perdait l onglet qui arrivait 8 ms plus tard.
  it('keeps the pending open while no conversation is active', () => {
    const m = new OpenedHere();
    m.opening('s-nouvelle', 0);
    expect(m.observe(undefined, undefined, 19)).toBeUndefined();
    expect(m.entries()).toEqual([]);
    // L onglet arrive enfin.
    expect(m.observe(undefined, tab('Claude Code'), 27)).toBe('s-nouvelle');
    expect(m.entries()).toEqual([{ sessionId: 's-nouvelle', title: 'Claude Code', group: 0, index: 16 }]);
  });

  // Le second : le panneau s ouvre sous « Claude Code » puis prend son titre.
  it('records again when the tab is renamed, rather than keeping a stale label', () => {
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
  it('does not close the pending open on the conversation it came from', () => {
    const m = new OpenedHere();
    m.opening('s-nouvelle', 0);
    expect(m.observe('s-autre', tab('#EDN monitoring', 15), 100)).toBe('s-autre');
    expect(m.observe(undefined, tab('Claude Code'), 200)).toBe('s-nouvelle');
  });

  it('lets the usual resolution answer when it names the awaited conversation', () => {
    const m = new OpenedHere();
    m.opening('s-nouvelle', 0);
    expect(m.observe('s-nouvelle', tab('Fiabilité IVECO moteur'), 900)).toBe('s-nouvelle');
  });

  it('gives up past the delay — the active tab has no reason left to be the one asked for', () => {
    const m = new OpenedHere();
    m.opening('s-nouvelle', 0);
    expect(m.observe(undefined, tab('Autre chose'), PENDING_OPEN_MS + 1)).toBeUndefined();
    expect(m.entries()).toEqual([]);
  });

  it('remembers several conversations, each in its place', () => {
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
describe('OpenedHere — the conversation left behind is not a change of mind', () => {
  it('keeps the pending open when the still-active tab is the one it came from', () => {
    const m = new OpenedHere();
    m.opening('s-nouvelle', 0);
    // Premier événement : on est toujours sur la conversation précédente.
    expect(m.observe('s-precedente', tab('#EDN monitoring', 15), 20)).toBe('s-precedente');
    // Le panneau demandé arrive enfin, et rien ne sait encore le nommer.
    expect(m.observe(undefined, tab('Claude Code'), 30)).toBe('s-nouvelle');
    expect(m.entries()).toEqual([{ sessionId: 's-nouvelle', title: 'Claude Code', group: 0, index: 16 }]);
  });

  it('coming back to the conversation left behind still does not close the pending open', () => {
    const m = new OpenedHere();
    m.opening('s-nouvelle', 0);
    m.observe('s-precedente', tab('#EDN monitoring', 15), 20);
    expect(m.observe('s-precedente', tab('#EDN monitoring', 15), 40)).toBe('s-precedente');
    expect(m.observe(undefined, tab('Claude Code'), 50)).toBe('s-nouvelle');
  });

  it('but a THIRD conversation does close it', () => {
    const m = new OpenedHere();
    m.opening('s-nouvelle', 0);
    m.observe('s-precedente', tab('#EDN monitoring', 15), 20);
    expect(m.observe('s-tierce', tab('Autre chose', 9), 30)).toBe('s-tierce');
    expect(m.observe(undefined, tab('Claude Code'), 40)).toBeUndefined();
    expect(m.entries()).toEqual([]);
  });
});
