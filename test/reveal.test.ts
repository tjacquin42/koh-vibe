import { describe, expect, it } from 'vitest';
import { locateClaudeTab, revealTabAt, type GroupLike, type MementoTab } from '../src/claude/reveal';
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
