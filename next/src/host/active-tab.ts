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
import { claudeTabsOf } from '../../../src/close/tabs';
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
    await this.read(now);
    const sessionId = sessionOfClaudeTab(this.memento, groups, { group, index });
    return sessionId === undefined ? { label: tab.label } : { label: tab.label, sessionId };
  }

  /**
   * The conversations whose tab is open in this window (15/11), read the way
   * V1 reads its restored tabs (extension.ts `refreshDormant`): the memento
   * ties a tab to its conversation, and only a title still on a Claude tab
   * counts — the memento is persisted state, and may still hold a tab closed
   * a moment ago.
   */
  async restored(now: number): Promise<ReadonlySet<string>> {
    const tabGroups = vscode.window.tabGroups as vscode.TabGroups | undefined;
    if (tabGroups === undefined) return new Set();
    await this.read(now);
    const labels = new Set(claudeTabsOf(tabGroups.all).map((t) => t.label));
    return new Set(this.memento.filter((t) => labels.has(t.title)).map((t) => t.sessionId));
  }

  private async read(now: number): Promise<void> {
    if (this.stateDb === undefined || now - this.readAt <= MEMENTO_TTL_MS) return;
    const raw = await readEditorMemento(this.stateDb);
    this.memento = raw === undefined ? [] : parseEditorMemento(raw);
    this.readAt = now;
  }

  /** The tab in front changed: what the memento said may be stale for it. */
  forget(): void {
    this.readAt = 0;
  }
}
