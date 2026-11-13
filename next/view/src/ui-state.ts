import { isSidebarTab, type SidebarTab } from '../../src/shared/protocol';

/**
 * What the view remembers between reloads: the tab, and which sections are
 * folded. A convenience only — lost state costs one click, so a bad or
 * missing value falls back to the default without complaint.
 */
export interface UiState {
  tab: SidebarTab;
  /** Section keys the user folded: a folder id, "unfiled", "closed", "proj:<name>"… */
  folded: string[];
}

export const DEFAULT_UI: UiState = { tab: 'sessions', folded: ['closed'] };

export function parseUiState(raw: unknown): UiState {
  if (typeof raw !== 'object' || raw === null) return DEFAULT_UI;
  const rec = raw as Record<string, unknown>;
  const tab = isSidebarTab(rec['tab']) ? rec['tab'] : DEFAULT_UI.tab;
  const folded = Array.isArray(rec['folded'])
    ? (rec['folded'] as unknown[]).filter((k): k is string => typeof k === 'string')
    : DEFAULT_UI.folded;
  return { tab, folded };
}

export function toggleFold(state: UiState, key: string): UiState {
  const has = state.folded.includes(key);
  return { ...state, folded: has ? state.folded.filter((k) => k !== key) : [...state.folded, key] };
}
