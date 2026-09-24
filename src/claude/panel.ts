import * as vscode from 'vscode';

/**
 * The view type Claude Code creates its panel under. VSCode prefixes it on
 * the tab (`mainThreadWebview-claudeVSCodePanel`), hence the substring test
 * below — the very test the Claude Code bundle applies to its own tabs when
 * it looks for its group. Read from two sources: the live tabs, and the
 * editor's persisted memento (claude/dormant.ts), where it is the
 * `providedId`.
 */
export const CLAUDE_PANEL_VIEW_TYPE = 'claudeVSCodePanel';

/** The little the test needs of a tab — `vscode.Tab` fits, and so does a plain object. */
export interface TabLike {
  label: string;
  input: unknown;
}

export function isClaudeTab(tab: TabLike): boolean {
  return tab.input instanceof vscode.TabInputWebview && tab.input.viewType.includes(CLAUDE_PANEL_VIEW_TYPE);
}
