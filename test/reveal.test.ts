import { describe, expect, it } from 'vitest';
import { locateClaudeTab, revealTabAt, sessionOfClaudeTab, type GroupLike, type MementoTab } from '../src/claude/reveal';
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
