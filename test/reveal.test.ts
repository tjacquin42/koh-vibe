import { describe, expect, it } from 'vitest';
import { isClaudeTabAt, locateClaudeTab, revealTabAt, sessionOfClaudeTab, type GroupLike, type MementoTab } from '../src/claude/reveal';
import { TabInputWebview } from './stubs/vscode';

const claude = (label: string): { label: string; input: unknown } => ({ label, input: new TabInputWebview('mainThreadWebview-claudeVSCodePanel') });
const file = (label: string): { label: string; input: unknown } => ({ label, input: { uri: label } });

describe('locateClaudeTab — where a restored tab sits now', () => {
  const groups: GroupLike[] = [
    { tabs: [file('a.ts'), claude('Telegram Alert'), claude('Claude Code'), claude('Claude Code')] },
    { tabs: [claude('List DB STYLE')] },
  ];

  it('trusts the memento position while a Claude tab of that title is still there', () => {
    expect(locateClaudeTab(groups, { sessionId: 'S', group: 0, index: 1, title: 'Telegram Alert' })).toEqual({ group: 0, index: 1 });
    expect(locateClaudeTab(groups, { sessionId: 'S', group: 1, index: 0, title: 'List DB STYLE' })).toEqual({ group: 1, index: 0 });
  });

  it('finds the tab by its title once it has moved', () => {
    expect(locateClaudeTab(groups, { sessionId: 'S', group: 0, index: 3, title: 'Telegram Alert' })).toEqual({ group: 0, index: 1 });
    expect(locateClaudeTab(groups, { sessionId: 'S', group: 5, index: 0, title: 'List DB STYLE' })).toEqual({ group: 1, index: 0 });
  });

  it('picks the first tab of a title the memento gives to this one session — duplicates are the same conversation', () => {
    const memento: MementoTab[] = [
      { sessionId: 'S', group: 0, index: 2, title: 'Claude Code' },
      { sessionId: 'S', group: 0, index: 3, title: 'Claude Code' },
    ];
    expect(locateClaudeTab(groups, { sessionId: 'S', group: 1, index: 4, title: 'Claude Code' }, memento)).toEqual({ group: 0, index: 2 });
  });

  it('gives up rather than guess when the memento gives that title to two different sessions', () => {
    const memento: MementoTab[] = [
      { sessionId: 'S', group: 0, index: 2, title: 'Claude Code' },
      { sessionId: 'T', group: 0, index: 3, title: 'Claude Code' },
    ];
    expect(locateClaudeTab(groups, { sessionId: 'S', group: 1, index: 4, title: 'Claude Code' }, memento)).toBeUndefined();
    // Without the memento, a lone title still resolves; two of a kind do not.
    expect(locateClaudeTab(groups, { sessionId: 'S', group: 1, index: 4, title: 'Claude Code' })).toEqual({ group: 0, index: 2 });
  });

  it('never returns a tab that is not a Claude one, whatever its title', () => {
    expect(locateClaudeTab(groups, { sessionId: 'S', group: 0, index: 0, title: 'a.ts' })).toBeUndefined();
  });

  it('still trusts the position when the same title sits there and elsewhere', () => {
    expect(locateClaudeTab(groups, { sessionId: 'S', group: 0, index: 2, title: 'Claude Code' })).toEqual({ group: 0, index: 2 });
  });
});

describe('revealTabAt — the workbench commands that bring a tab to the front', () => {
  it('focuses the group, then opens the editor at that index', async () => {
    const calls: unknown[][] = [];
    const run = async (command: string, ...args: unknown[]): Promise<unknown> => {
      calls.push([command, ...args]);
      return undefined;
    };
    expect(await revealTabAt({ group: 1, index: 3 }, run)).toBe(true);
    expect(calls).toEqual([['workbench.action.focusSecondEditorGroup'], ['workbench.action.openEditorAtIndex', 3]]);
  });

  it('declines a group the workbench has no command for, running nothing', async () => {
    const calls: unknown[][] = [];
    expect(await revealTabAt({ group: 8, index: 0 }, async (...a) => void calls.push(a))).toBe(false);
    expect(calls).toEqual([]);
  });
});

// The other direction: the user clicked a tab, and the dashboard has to select
// the row that goes with it. Same table as `locateClaudeTab`, read backwards,
// and the same refusal to guess — selecting the wrong conversation is worse
// than selecting none.
describe('sessionOfClaudeTab — whose conversation is the tab under the cursor', () => {
  const groups: GroupLike[] = [
    { tabs: [file('a.ts'), claude('Telegram Alert'), claude('Claude Code')] },
    { tabs: [claude('List DB STYLE')] },
  ];
  const memento: MementoTab[] = [
    { sessionId: 's-telegram', title: 'Telegram Alert', group: 0, index: 1 },
    { sessionId: 's-untitled', title: 'Claude Code', group: 0, index: 2 },
    { sessionId: 's-db', title: 'List DB STYLE', group: 1, index: 0 },
  ];

  it('reads the session off the memento entry sitting at that very position', () => {
    expect(sessionOfClaudeTab(memento, groups, { group: 0, index: 1 })).toBe('s-telegram');
    expect(sessionOfClaudeTab(memento, groups, { group: 1, index: 0 })).toBe('s-db');
  });

  it('falls back to the title when the tab has moved since the memento was written', () => {
    const moved: GroupLike[] = [{ tabs: [claude('List DB STYLE'), file('a.ts')] }];
    expect(sessionOfClaudeTab(memento, moved, { group: 0, index: 0 })).toBe('s-db');
  });

  // Position AND title agreeing is the strongest evidence there is, and it is
  // what `locateClaudeTab` bets on in the other direction. The ambiguity guard
  // belongs to the fallback, where position no longer vouches for anything.
  const twins: MementoTab[] = [
    { sessionId: 's-one', title: 'Claude Code', group: 0, index: 2 },
    { sessionId: 's-two', title: 'Claude Code', group: 0, index: 9 },
  ];

  it('trusts an exact position match even when the title is shared, as its twin does', () => {
    expect(sessionOfClaudeTab(twins, groups, { group: 0, index: 2 })).toBe('s-one');
  });

  it('refuses a shared title once the position no longer agrees — nothing vouches for either', () => {
    const moved: GroupLike[] = [{ tabs: [file('a.ts'), claude('Claude Code')] }];
    expect(sessionOfClaudeTab(twins, moved, { group: 0, index: 1 })).toBeUndefined();
  });

  it('refuses a tab that is not a Claude one — a file must select nothing', () => {
    expect(sessionOfClaudeTab(memento, groups, { group: 0, index: 0 })).toBeUndefined();
  });

  it('refuses a position that holds no tab at all', () => {
    expect(sessionOfClaudeTab(memento, groups, { group: 0, index: 99 })).toBeUndefined();
    expect(sessionOfClaudeTab(memento, groups, { group: 9, index: 0 })).toBeUndefined();
  });

  it('refuses a Claude tab the memento has never heard of', () => {
    const fresh: GroupLike[] = [{ tabs: [claude('Opened a second ago')] }];
    expect(sessionOfClaudeTab(memento, fresh, { group: 0, index: 0 })).toBeUndefined();
  });
});

// Ce que la fenêtre a ouvert elle-même passe devant le mémento : celui-ci est
// de l'état persisté et ignore un onglet tout juste rouvert. Rien de spécial
// n'est ajouté à la fonction pour cela — une entrée retenue au vol a la même
// forme, et vient simplement en tête de la liste.
describe('sessionOfClaudeTab — une entrée fraîche devant un mémento en retard', () => {
  const groups: GroupLike[] = [{ tabs: [claude('Ancien onglet'), claude('Rouverte à l instant')] }];
  // Le mémento décrit encore la disposition d'avant la réouverture.
  const stale: MementoTab[] = [{ sessionId: 's-ancienne', title: 'Ancien onglet', group: 0, index: 1 }];

  it('ne sait rien de l onglet rouvert tant que le mémento seul parle', () => {
    expect(sessionOfClaudeTab(stale, groups, { group: 0, index: 1 })).toBeUndefined();
  });

  it('le reconnaît dès que la fenêtre place devant ce qu elle a ouvert', () => {
    const fresh: MementoTab = { sessionId: 's-rouverte', title: 'Rouverte à l instant', group: 0, index: 1 };
    expect(sessionOfClaudeTab([fresh, ...stale], groups, { group: 0, index: 1 })).toBe('s-rouverte');
  });

  it('cesse simplement de correspondre quand le titre retenu a vieilli, sans jamais désigner l autre', () => {
    const outdated: MementoTab = { sessionId: 's-rouverte', title: 'Titre d avant', group: 0, index: 1 };
    expect(sessionOfClaudeTab([outdated, ...stale], groups, { group: 0, index: 1 })).toBeUndefined();
  });

  it('laisse le mémento répondre pour les onglets qu il connaît toujours', () => {
    const fresh: MementoTab = { sessionId: 's-rouverte', title: 'Rouverte à l instant', group: 0, index: 1 };
    expect(sessionOfClaudeTab([fresh, ...stale], groups, { group: 0, index: 0 })).toBe('s-ancienne');
  });
});

describe('isClaudeTabAt — distinguer une conversation d un fichier', () => {
  const groups: GroupLike[] = [{ tabs: [file('a.ts'), claude('Telegram Alert')] }];

  it('reconnaît une conversation', () => {
    expect(isClaudeTabAt(groups, { group: 0, index: 1 })).toBe(true);
  });

  it('refuse un fichier, une place vide, un groupe qui n existe pas', () => {
    expect(isClaudeTabAt(groups, { group: 0, index: 0 })).toBe(false);
    expect(isClaudeTabAt(groups, { group: 0, index: 9 })).toBe(false);
    expect(isClaudeTabAt(groups, { group: 5, index: 0 })).toBe(false);
  });
});

// Le défaut que l usage a révélé : une conversation neuve s appelle « Claude
// Code », comme toutes les autres. Deux onglets neufs portent donc le même nom,
// et le mémento n en connaît souvent qu un — si bien que les DEUX onglets
// renvoyaient vers la même ligne. Le garde-fou existant ne regardait que
// l ambiguïté DANS le mémento, jamais celle des onglets réellement ouverts.
describe('sessionOfClaudeTab — deux onglets du même nom ne désignent personne', () => {
  const groups: GroupLike[] = [
    { tabs: [claude('Claude Code'), claude('Claude Code'), claude('Titrée')] },
  ];
  const memento: MementoTab[] = [
    { sessionId: 's-premiere', title: 'Claude Code', group: 0, index: 0 },
    { sessionId: 's-titree', title: 'Titrée', group: 0, index: 2 },
  ];

  it('refuse, même quand le mémento tombe pile sur la position', () => {
    // Le mémento place « s-premiere » exactement là. Mais l onglet voisin porte
    // le même nom : rien ne dit lequel des deux est celui du mémento, et se
    // tromper de ligne est pire que n en désigner aucune.
    expect(sessionOfClaudeTab(memento, groups, { group: 0, index: 0 })).toBeUndefined();
  });

  it('refuse aussi l autre, plutôt que de lui prêter la même conversation', () => {
    expect(sessionOfClaudeTab(memento, groups, { group: 0, index: 1 })).toBeUndefined();
  });

  it('répond normalement pour un nom que ne porte qu un seul onglet', () => {
    expect(sessionOfClaudeTab(memento, groups, { group: 0, index: 2 })).toBe('s-titree');
  });

  it('compte les onglets de TOUS les groupes, un doublon ailleurs compte autant', () => {
    const split: GroupLike[] = [{ tabs: [claude('Claude Code')] }, { tabs: [claude('Claude Code')] }];
    expect(sessionOfClaudeTab(memento, split, { group: 0, index: 0 })).toBeUndefined();
  });
});
