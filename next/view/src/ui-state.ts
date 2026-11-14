import { isSidebarTab, type SidebarTab } from '../../src/shared/protocol';
import { COUNT_MODES, SESSION_SORTS, SPANS_H, type CountMode, type SessionSort } from './sections';

export const COCKPIT_VIEWS = ['board', 'wall', 'feed', 'timeline', 'usage'] as const;
export type CockpitView = (typeof COCKPIT_VIEWS)[number];

/**
 * What the view remembers between reloads: the tab, and which sections are
 * folded. A convenience only — lost state costs one click, so a bad or
 * missing value falls back to the default without complaint.
 */
export interface UiState {
  tab: SidebarTab;
  /** Section keys the user folded: a folder id, "unfiled", "closed", "proj:<name>"… */
  folded: string[];
  cockpit: {
    view: CockpitView;
    /** A folder id, « unfiled », or null for every conversation. */
    folder: string | null;
    count: CountMode;
    /** The timeline's span, in hours. */
    spanH: number;
  };
  /**
   * Sizes the user dragged a separator to, in pixels, by separator: absent
   * means the layout's own size (a double-click on the separator brings it
   * back).
   */
  sizes: Record<string, number>;
  /** The usage at the foot of the sidebar; off from the settings. */
  showUsage: boolean;
  /** The extension start this state was last seen under (ViewContext.launch). */
  launch?: string;
  /**
   * « For you » cards closed with their ×, by conversation: the time of its
   * last event then. A new event — another question — brings the card back.
   */
  dismissed: Record<string, number>;
  /** How a folder's conversations are ordered (sections.ts sortSessions). */
  sort: SessionSort;
}

/** A dragged size outside this is a stale value from another screen: dropped, not clamped. */
const SIZE_MIN = 40;
const SIZE_MAX = 4000;

export const DEFAULT_UI: UiState = {
  tab: 'sessions',
  folded: ['closed'],
  cockpit: { view: 'board', folder: null, count: 'weighted', spanH: 8 },
  sizes: {},
  showUsage: true,
  dismissed: {},
  sort: 'manual',
};

function parseSizes(raw: unknown): Record<string, number> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === 'number' && Number.isFinite(v) && v >= SIZE_MIN && v <= SIZE_MAX) out[k] = Math.round(v);
  }
  return out;
}

export function setSize(state: UiState, key: string, px: number | undefined): UiState {
  const sizes = { ...state.sizes };
  if (px === undefined) delete sizes[key];
  else sizes[key] = Math.round(px);
  return { ...state, sizes };
}

function parseCockpit(raw: unknown): UiState['cockpit'] {
  const d = DEFAULT_UI.cockpit;
  if (typeof raw !== 'object' || raw === null) return d;
  const r = raw as Record<string, unknown>;
  const view = (COCKPIT_VIEWS as readonly unknown[]).includes(r['view']) ? (r['view'] as CockpitView) : d.view;
  const folder = typeof r['folder'] === 'string' ? r['folder'] : null;
  const count = (COUNT_MODES as readonly unknown[]).includes(r['count']) ? (r['count'] as CountMode) : d.count;
  const spanH = typeof r['spanH'] === 'number' && SPANS_H.includes(r['spanH']) ? r['spanH'] : d.spanH;
  return { view, folder, count, spanH };
}

export function parseUiState(raw: unknown): UiState {
  if (typeof raw !== 'object' || raw === null) return DEFAULT_UI;
  const rec = raw as Record<string, unknown>;
  const tab = isSidebarTab(rec['tab']) ? rec['tab'] : DEFAULT_UI.tab;
  const folded = Array.isArray(rec['folded'])
    ? (rec['folded'] as unknown[]).filter((k): k is string => typeof k === 'string')
    : DEFAULT_UI.folded;
  const showUsage = typeof rec['showUsage'] === 'boolean' ? rec['showUsage'] : DEFAULT_UI.showUsage;
  const dismissed: Record<string, number> = {};
  if (typeof rec['dismissed'] === 'object' && rec['dismissed'] !== null) {
    for (const [k, v] of Object.entries(rec['dismissed'] as Record<string, unknown>)) if (typeof v === 'number' && Number.isFinite(v)) dismissed[k] = v;
  }
  const sort = SESSION_SORTS.find((x) => x === rec['sort']) ?? DEFAULT_UI.sort;
  const out: UiState = { tab, folded, cockpit: parseCockpit(rec['cockpit']), sizes: parseSizes(rec['sizes']), showUsage, dismissed, sort };
  if (typeof rec['launch'] === 'string') out.launch = rec['launch'];
  return out;
}

/**
 * At a new start of the extension every folder starts folded — the
 * temporary sessions included — and what was opened before is forgotten
 * (14/11). A reload of the view under the same start changes nothing.
 * Other folds (closed groups, projects) are kept as they were.
 */
export function atLaunch(state: UiState, launch: string, folderIds: readonly string[]): UiState {
  if (state.launch === launch) return state;
  const folders = [...folderIds, 'unfiled'];
  return { ...state, launch, folded: [...new Set([...state.folded, ...folders])] };
}

/** Closes a « For you » card; only the conversations still waiting are kept, so the list stays short. */
export function dismiss(state: UiState, sessionId: string, lastEventAt: number, waiting: readonly string[]): UiState {
  const kept = Object.fromEntries(Object.entries(state.dismissed).filter(([id]) => waiting.includes(id)));
  return { ...state, dismissed: { ...kept, [sessionId]: lastEventAt } };
}

export function toggleFold(state: UiState, key: string): UiState {
  const has = state.folded.includes(key);
  return { ...state, folded: has ? state.folded.filter((k) => k !== key) : [...state.folded, key] };
}
