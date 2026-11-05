/**
 * The editor's tab bar, as `workbench.editor.showTabs` sets it.
 *
 * Not a field of the shared settings file (settings/model.ts): it is the
 * editor's own setting, and copying it there would make two sources of truth
 * that drift the first time someone changes it from the editor's settings.
 * The dashboard only reads and writes it — with `single`, the tab bar shrinks
 * to the title of the current tab, and the session list does the switching.
 */
export type TabsMode = 'multiple' | 'single' | 'none';

/** In the order the picker offers them. */
export const TABS_MODES: readonly TabsMode[] = ['multiple', 'single', 'none'];

/**
 * Editors before VSCode 1.81 held a boolean, where `false` showed the current
 * tab alone, as a title — that is `single` today. Anything unreadable is the
 * editor's own default.
 */
export function parseTabsMode(v: unknown): TabsMode {
  if (v === true) return 'multiple';
  if (v === false) return 'single';
  return TABS_MODES.find((m) => m === v) ?? 'multiple';
}

/** What `WorkspaceConfiguration.inspect` reports, as far as the target is concerned. */
export interface ScopedValues {
  globalValue?: unknown;
  workspaceValue?: unknown;
  workspaceFolderValue?: unknown;
}

export type TabsTarget = 'global' | 'workspace' | 'workspaceFolder';

/**
 * Where to write so the change is SEEN: the narrowest scope that already sets
 * the value, the user settings otherwise. Written to the user settings while
 * the workspace holds its own value, a choice would be saved and have no
 * effect — a picker that does nothing.
 */
export function tabsTarget(values: ScopedValues): TabsTarget {
  if (values.workspaceFolderValue !== undefined) return 'workspaceFolder';
  if (values.workspaceValue !== undefined) return 'workspace';
  return 'global';
}
