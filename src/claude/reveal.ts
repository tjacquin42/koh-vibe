import * as vscode from 'vscode';

/** A tab's place in the window: the group's index in `tabGroups.all`, the tab's index in it. */
export interface TabPosition {
  group: number;
  index: number;
}

/** The little the locator needs of a tab and a group — `vscode.Tab`/`TabGroup` fit, and so does a plain object. */
export interface TabLike {
  label: string;
  input: unknown;
}
export interface GroupLike {
  tabs: readonly TabLike[];
}

const PANEL_VIEW_TYPE = 'claudeVSCodePanel';

function isClaudeTab(tab: TabLike): boolean {
  return tab.input instanceof vscode.TabInputWebview && tab.input.viewType.includes(PANEL_VIEW_TYPE);
}

/**
 * Where a restored Claude tab sits now. The memento's position is trusted
 * when it still holds a Claude tab of that title — the memento is persisted
 * state, and tabs may have moved since. Failing that, the one tab of that
 * title in the window; failing that, nothing: two tabs of the same title
 * cannot be told apart, and revealing the wrong conversation is worse than
 * revealing none.
 */
export function locateClaudeTab(
  groups: readonly GroupLike[],
  want: { group: number; index: number; title: string },
): TabPosition | undefined {
  const at = groups[want.group]?.tabs[want.index];
  if (at !== undefined && isClaudeTab(at) && at.label === want.title) return { group: want.group, index: want.index };
  const found: TabPosition[] = [];
  groups.forEach((g, group) => {
    g.tabs.forEach((t, index) => {
      if (isClaudeTab(t) && t.label === want.title) found.push({ group, index });
    });
  });
  return found.length === 1 ? found[0] : undefined;
}

const FOCUS_GROUP: readonly string[] = [
  'workbench.action.focusFirstEditorGroup',
  'workbench.action.focusSecondEditorGroup',
  'workbench.action.focusThirdEditorGroup',
  'workbench.action.focusFourthEditorGroup',
  'workbench.action.focusFifthEditorGroup',
  'workbench.action.focusSixthEditorGroup',
  'workbench.action.focusSeventhEditorGroup',
  'workbench.action.focusEighthEditorGroup',
];

/**
 * Brings a tab to the front by position: focus its group, then open the
 * editor at that index in it. The workbench's own commands, because a webview
 * tab another extension owns cannot be revealed through the API — and asking
 * Claude Code to open the session creates a SECOND tab for it whenever it has
 * not registered the restored one yet (observed: three processes resuming
 * the same conversation). Resolves `false` for a group beyond the eighth,
 * which the workbench has no command for.
 */
export async function revealTabAt(
  pos: TabPosition,
  run: (command: string, ...args: unknown[]) => Thenable<unknown> = (c, ...a) => vscode.commands.executeCommand(c, ...a),
): Promise<boolean> {
  const focus = FOCUS_GROUP[pos.group];
  if (focus === undefined) return false;
  await run(focus);
  await run('workbench.action.openEditorAtIndex', pos.index);
  return true;
}
