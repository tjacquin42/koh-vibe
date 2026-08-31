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

/** What the memento knows of a tab: its session, its title, its place. */
export interface MementoTab {
  sessionId: string;
  title: string;
  group: number;
  index: number;
}

/**
 * Where a restored Claude tab sits now. The memento's position is trusted
 * when it still holds a Claude tab of that title — the memento is persisted
 * state, and tabs may have moved since. Failing that, a tab of that title in
 * the window, provided the title belongs to this one session in the memento:
 * a conversation open in several tabs (the duplicates the editor command
 * used to create) is the same conversation whichever tab is picked, while two
 * conversations of one title — untitled ones all read "Claude Code" — cannot
 * be told apart, and reaching the wrong one is worse than reaching none.
 */
export function locateClaudeTab(
  groups: readonly GroupLike[],
  want: MementoTab,
  memento: readonly MementoTab[] = [want],
): TabPosition | undefined {
  const at = groups[want.group]?.tabs[want.index];
  if (at !== undefined && isClaudeTab(at) && at.label === want.title) return { group: want.group, index: want.index };
  const owners = new Set(memento.filter((t) => t.title === want.title).map((t) => t.sessionId));
  owners.add(want.sessionId);
  if (owners.size > 1) return undefined;
  for (const [group, g] of groups.entries()) {
    for (const [index, t] of g.tabs.entries()) {
      if (isClaudeTab(t) && t.label === want.title) return { group, index };
    }
  }
  return undefined;
}

/** Si la place indiquée porte bien une conversation, et non un fichier ou rien. */
export function isClaudeTabAt(groups: readonly GroupLike[], at: TabPosition): boolean {
  const tab = groups[at.group]?.tabs[at.index];
  return tab !== undefined && isClaudeTab(tab);
}

/**
 * The conversation a tab belongs to — `locateClaudeTab` read backwards.
 *
 * A click in the editor has to select the matching row in the dashboard, and
 * the memento is the only table that ties a tab to a conversation: nothing on
 * a `Tab` carries a session id.
 *
 * The same two steps, and the same refusal to guess. The memento's own
 * position is trusted when a Claude tab of that title still sits there;
 * failing that, a title that belongs to ONE conversation in the memento
 * identifies it wherever the tab has moved. Two conversations of one title —
 * untitled ones all read "Claude Code" — cannot be told apart, and selecting
 * the wrong row is worse than selecting none.
 */
export function sessionOfClaudeTab(
  memento: readonly MementoTab[],
  groups: readonly GroupLike[],
  at: TabPosition,
): string | undefined {
  const tab = groups[at.group]?.tabs[at.index];
  if (tab === undefined || !isClaudeTab(tab)) return undefined;
  const here = memento.find((t) => t.group === at.group && t.index === at.index && t.title === tab.label);
  if (here !== undefined) return here.sessionId;
  const owners = new Set(memento.filter((t) => t.title === tab.label).map((t) => t.sessionId));
  return owners.size === 1 ? [...owners][0] : undefined;
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
