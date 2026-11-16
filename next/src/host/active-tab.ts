/**
 * The conversation whose tab is in front (14/11): the list marks its row, so
 * one always knows which conversation is selected — V1's « reveal the active
 * session », read with V1's own helpers.
 *
 * The editor's memento is the only table that ties a tab to a conversation
 * (V1 claude/reveal.ts). Reading it starts a `sqlite3`: it is read again at
 * most every two seconds while the tabs are moving — the editor writes it a
 * little after a tab opens — and once a minute when they are still (16/11):
 * every build asked for it, one every few seconds, in every window, for a
 * table that only changes with the tabs. A tab it does not know yet — a
 * conversation just opened — comes with its title alone, and the view matches
 * it (sections.ts `activeSessionId`).
 */
import * as vscode from 'vscode';
import { parseEditorMemento, readEditorMemento, type ClaudeTab } from '../../../src/claude/dormant';
import { isClaudeTabAt, sessionOfClaudeTab } from '../../../src/claude/reveal';
import { claudeTabsOf } from '../../../src/close/tabs';
import type { ActiveTabView } from '../shared/protocol';

const MEMENTO_TTL_MS = 2_000;
/** How long after the tabs last moved the memento is still read that often. */
const SETTLING_MS = 20_000;
const STILL_TTL_MS = 60_000;

export class ActiveTab {
  private memento: readonly ClaudeTab[] = [];
  private readAt = 0;
  /** When the tabs last moved; none yet at the start, where the editor may still be restoring them. */
  private movedAt: number | undefined;

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
    if (this.stateDb === undefined) return;
    this.movedAt ??= now;
    const ttl = now - this.movedAt <= SETTLING_MS ? MEMENTO_TTL_MS : STILL_TTL_MS;
    if (this.readAt !== 0 && now - this.readAt <= ttl) return;
    const raw = await readEditorMemento(this.stateDb);
    this.memento = raw === undefined ? [] : parseEditorMemento(raw);
    this.readAt = now;
  }

  /** The tab in front changed: what the memento said may be stale for it. */
  forget(now: number = Date.now()): void {
    this.readAt = 0;
    this.movedAt = now;
  }
}
