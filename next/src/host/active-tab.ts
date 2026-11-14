/**
 * The conversation whose tab is in front (14/11): the list marks its row, so
 * one always knows which conversation is selected — V1's « reveal the active
 * session », read with V1's own helpers.
 *
 * The editor's memento is the only table that ties a tab to a conversation
 * (V1 claude/reveal.ts): read again at most every two seconds. A tab it does
 * not know yet — a conversation just opened — comes with its title alone, and
 * the view matches it (sections.ts `activeSessionId`).
 */
import * as vscode from 'vscode';
import { parseEditorMemento, readEditorMemento, type ClaudeTab } from '../../../src/claude/dormant';
import { isClaudeTabAt, sessionOfClaudeTab } from '../../../src/claude/reveal';
import type { ActiveTabView } from '../shared/protocol';

const MEMENTO_TTL_MS = 2_000;

export class ActiveTab {
  private memento: readonly ClaudeTab[] = [];
  private readAt = 0;

  constructor(private readonly stateDb: string | undefined) {}

  async current(now: number): Promise<ActiveTabView | undefined> {
    const tabGroups = vscode.window.tabGroups as vscode.TabGroups | undefined;
    if (tabGroups === undefined) return undefined;
    const groups = tabGroups.all;
    const active = tabGroups.activeTabGroup;
    const group = groups.indexOf(active);
    const tab = active.activeTab;
    const index = tab === undefined ? -1 : active.tabs.indexOf(tab);
    if (tab === undefined || group < 0 || index < 0 || !isClaudeTabAt(groups, { group, index })) return undefined;
    if (this.stateDb !== undefined && now - this.readAt > MEMENTO_TTL_MS) {
      const raw = await readEditorMemento(this.stateDb);
      this.memento = raw === undefined ? [] : parseEditorMemento(raw);
      this.readAt = now;
    }
    const sessionId = sessionOfClaudeTab(this.memento, groups, { group, index });
    return sessionId === undefined ? { label: tab.label } : { label: tab.label, sessionId };
  }

  /** The tab in front changed: what the memento said may be stale for it. */
  forget(): void {
    this.readAt = 0;
  }
}
