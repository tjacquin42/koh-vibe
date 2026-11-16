import { isSidebarTab, SIDEBAR_TABS, type SidebarTab } from '../../src/shared/protocol';
import { SESSION_SORTS, SPANS_H, type SessionSort } from './sections';
import { normalizeOrder } from './order';
import type { SpendWindow } from '../../src/shared/protocol';

/** The cockpit's views; Usage (15/11) is the sidebar's own tab, the same, nothing more nor less. */
export const COCKPIT_VIEWS = ['board', 'wall', 'feed', 'timeline', 'usage'] as const;
export type CockpitView = (typeof COCKPIT_VIEWS)[number];

/** The windows « Hungriest conversations » can show. */
export const SPEND_WINDOWS: readonly SpendWindow[] = ['5h', '24h', '7d'];

/** The choices for how many closed conversations the Archives show. */
export const ARCHIVE_COUNTS = [10, 20, 50] as const;
export type ArchiveCount = (typeof ARCHIVE_COUNTS)[number];

/**
 * What the view remembers between reloads: the tab, and which sections are
 * folded. A convenience only — lost state costs one click, so a bad or
 * missing value falls back to the default without complaint.
 */
export interface UiState {
  tab: SidebarTab;
  /** Section keys the user folded: a folder id, "unfiled", "archives", "proj:<name>"… */
  folded: string[];
  cockpit: {
    view: CockpitView;
    /** A folder id, « unfiled », or null for every conversation. */
    folder: string | null;
    /** The timeline's span, in hours. */
    spanH: number;
  };
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
  /** How many closed conversations the Archives show, the latest first (15/11). */
  archives: ArchiveCount;
  /** The window « Hungriest conversations » shows, kept as last picked (16/11). */
  spendWindow: SpendWindow;
  /** The sidebar's tabs and the cockpit's views, in the order dragged (hooks/useReorder.ts). */
  tabOrder: SidebarTab[];
  viewOrder: CockpitView[];
}

export const DEFAULT_UI: UiState = {
  tab: 'sessions',
  folded: [],
  cockpit: { view: 'board', folder: null, spanH: 8 },
  showUsage: true,
  dismissed: {},
  // By state by default (15/11): what waits for you first.
  sort: 'status',
  archives: 10,
  spendWindow: '5h',
  tabOrder: [...SIDEBAR_TABS],
  viewOrder: [...COCKPIT_VIEWS],
};

function parseCockpit(raw: unknown): UiState['cockpit'] {
  const d = DEFAULT_UI.cockpit;
  if (typeof raw !== 'object' || raw === null) return d;
  const r = raw as Record<string, unknown>;
  const view = (COCKPIT_VIEWS as readonly unknown[]).includes(r['view']) ? (r['view'] as CockpitView) : d.view;
  const folder = typeof r['folder'] === 'string' ? r['folder'] : null;
  const spanH = typeof r['spanH'] === 'number' && SPANS_H.includes(r['spanH']) ? r['spanH'] : d.spanH;
  return { view, folder, spanH };
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
  const archives = ARCHIVE_COUNTS.find((x) => x === rec['archives']) ?? DEFAULT_UI.archives;
  const spendWindow = SPEND_WINDOWS.find((x) => x === rec['spendWindow']) ?? DEFAULT_UI.spendWindow;
  const out: UiState = {
    tab,
    folded,
    cockpit: parseCockpit(rec['cockpit']),
    showUsage,
    dismissed,
    sort,
    archives,
    spendWindow,
    tabOrder: normalizeOrder(rec['tabOrder'], SIDEBAR_TABS),
    viewOrder: normalizeOrder(rec['viewOrder'], COCKPIT_VIEWS),
  };
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

/** Folds, or unfolds, several sections at once — « fold all », « unfold all ». */
export function setFolds(state: UiState, keys: readonly string[], folded: boolean): UiState {
  const next = folded ? [...new Set([...state.folded, ...keys])] : state.folded.filter((k) => !keys.includes(k));
  return next.length === state.folded.length && next.every((k, i) => k === state.folded[i]) ? state : { ...state, folded: next };
}

export function toggleFold(state: UiState, key: string): UiState {
  const has = state.folded.includes(key);
  return { ...state, folded: has ? state.folded.filter((k) => k !== key) : [...state.folded, key] };
}
