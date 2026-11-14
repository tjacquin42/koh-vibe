/**
 * The contract between the extension host and the web view.
 *
 * Shared by both sides and imported by both bundles, so it must stay free of
 * any runtime dependency: plain types plus the two guards below. The view
 * never sees the V1 types themselves — the host maps them to these shapes,
 * which keeps the view's bundle free of `node:` and `vscode` imports and lets
 * the on-disk format evolve without touching the UI.
 */

import { isActionResult, parseAction, type Action, type ActionResult, type EditorTabs, type LanguageChoice } from './actions';
import type { ThemeState } from './theme';

export type SessionStatus = 'running' | 'waiting' | 'done_unseen' | 'idle';
export type SessionOrigin = 'vscode' | 'terminal' | 'desktop' | 'sdk' | 'unknown';

export interface SessionView {
  id: string;
  /** Claude's title for the conversation, absent until it has set one. */
  title?: string;
  /**
   * Just opened, nothing written yet: idle, open, no tool run, and neither a title
   * nor a single request in its transcript. Shown as « New » (14/11). Only
   * set once the transcripts have been read — before that, a quiet old
   * conversation would pass for a new one.
   */
  fresh?: true;
  project: string;
  branch?: string;
  status: SessionStatus;
  origin: SessionOrigin;
  toolCount: number;
  lastEventAt: number;
  startedAt?: number;
  endedAt?: number;
  currentAction?: { tool: string; target?: string };
  pendingPermission?: { tool: string; summary: string };
  tokens?: { input: number; output: number };
  /**
   * When a temporary conversation — filed nowhere — leaves the list on its
   * own, if the setting is on. Absent for a filed or ended one.
   */
  expiresAt?: number;
}

export interface FolderView {
  id: string;
  name: string;
  /** A neutral color identifier ("blue", "green"…), mapped to a value by the view. */
  color?: string;
  /** Session ids filed here, in display order. */
  sessionIds: string[];
}

export interface UsageWindowView {
  /** 0–100. */
  percent: number;
  /** Epoch MILLISECONDS — the host converts V1's seconds. */
  resetsAt?: number;
}

export interface ModelWindowView extends UsageWindowView {
  /** The model the weekly window counts, e.g. "Opus". */
  name: string;
}

export interface UsageView {
  at: number;
  source: 'api' | 'statusline';
  fiveHour?: UsageWindowView;
  weekly?: UsageWindowView;
  /** Weekly windows scoped to one model, in the order the source lists them. */
  models: ModelWindowView[];
}

export interface ArtifactView {
  slug: string;
  title: string;
  updatedAt?: number;
  pinned: boolean;
  /** The project it is filed under (or its title points to); absent for « Other ». */
  project?: string;
}

export type RoutineGroup = 'today' | 'tomorrow' | 'week' | 'later' | 'paused';

export interface RoutineView {
  id: string;
  name: string;
  enabled: boolean;
  nextRunAt?: number;
  /** Where it sits in the list, computed by the host against the snapshot's time. */
  group: RoutineGroup;
  /** Recurring schedule, a cron expression read in UTC. Absent for a one-shot. */
  cron?: string;
  /** `owner/name` of each repository it works in. */
  repos: string[];
  /**
   * A one-shot already fired or past due (V1 `isSpent`): nothing to run, and
   * never resumed — that might run it at once, unasked.
   */
  spent: boolean;
}

export type ProcessKind = 'mcp' | 'shell' | 'work';

export interface ProcessView {
  pid: number;
  /** The command line made readable (V1's `displayCommand`). */
  label: string;
  kind: ProcessKind;
  /** Seconds since it started. */
  elapsed: number;
  /** Resident memory, kilobytes. */
  rss: number;
  /** How deep under the session it sits; 0 = started by the session itself. */
  depth: number;
}

export interface OrphanView {
  /** The adopted process and everything under it, root first. */
  tree: ProcessView[];
  cwd: string;
}

export interface ProcessesView {
  at: number;
  /** What each live conversation is running, keyed by session id. Absent = nothing. */
  bySession: Record<string, ProcessView[]>;
  /**
   * Development servers no conversation carries any more. Only looked for
   * while a view shows the Processes tab — it costs an `lsof`.
   */
  orphans?: OrphanView[];
}

/** Tokens as the API counts them. `cacheRead` is most of the volume; V1 never saw it. */
export interface TokenCount {
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
}

export type ActivityKind = 'prompt' | 'text' | 'tool';

export interface ActivityItemView {
  at: number;
  sessionId: string;
  kind: ActivityKind;
  /** The prompt or reply's first line, or the tool's target. */
  text: string;
  /** For a tool call: its name. */
  tool?: string;
  /** Made by a subagent of the conversation rather than the conversation itself. */
  subagent: boolean;
}

export interface ActivitySessionView {
  id: string;
  title?: string;
  project: string;
  /** The conversation's own turns, within the window. */
  tokens: TokenCount;
  /** Its subagents' turns, within the window — counted apart, shown together. */
  subagentTokens: TokenCount;
  /** Subagent transcripts active within the window. */
  subagents: number;
  /** Stretches of activity, [start, end] epoch ms, oldest first. */
  busy: [number, number][];
  /** Its latest lines, oldest first — the wall's tile. */
  tail: ActivityItemView[];
  lastAt: number;
}

/**
 * What the transcripts say about the last hours (host/activity). Built only
 * while the cockpit is open: reading transcripts is the costliest thing the
 * V2 does.
 */
export interface ActivityView {
  at: number;
  /** Start of the window. */
  since: number;
  /** Most recently active first. */
  sessions: ActivitySessionView[];
  /** Newest first, across every conversation. */
  feed: ActivityItemView[];
}

/** One tool call on the session sheet. */
export interface SheetToolView {
  at: number;
  tool: string;
  target?: string;
  /** The subagent that made it (its id on the sheet), absent for the conversation itself. */
  agent?: string;
}

/** A subagent of the conversation, from its transcript and its `.meta.json`. */
export interface SheetAgentView {
  id: string;
  /** What it was asked: the description it was started with, or the first line of its prompt. */
  label: string;
  /** `general-purpose`, `Explore`…, when known. */
  type?: string;
  model?: string;
  tokens: TokenCount;
  tools: number;
  firstAt: number;
  lastAt: number;
  /** From its meta file; absent when Claude Code did not say. */
  finished?: boolean;
}

/** A file the conversation (or one of its subagents) wrote to. */
export interface SheetFileView {
  /** Relative to the conversation's directory, or with `~` for the home — never the full home path. */
  path: string;
  /** Edit, Write… calls on it. */
  writes: number;
  lastAt: number;
}

/**
 * Everything about ONE conversation over the window: what it ran, its
 * subagents, the files it changed. Built only for the conversation the
 * cockpit shows; its processes come from `Snapshot.processes`.
 */
export interface SessionSheetView {
  id: string;
  since: number;
  /** Newest first, capped. */
  tools: SheetToolView[];
  toolCount: number;
  agents: SheetAgentView[];
  files: SheetFileView[];
  tokens: TokenCount;
  subagentTokens: TokenCount;
  /** The last thing the person asked, when it is in the window. */
  lastPrompt?: { at: number; text: string };
}

/** The shared settings (`settings.json`), as far as the view shows them. */
export interface SettingsView {
  animate: boolean;
  persistent: boolean;
  expireTemporary: boolean;
  /** 0–100. The sounds themselves are fixed — Attente and Fin — so the view has no name to show. */
  volume: number;
}

export interface ClosedView {
  sessionId: string;
  title?: string;
  project: string;
  closedAt: number;
  /**
   * Whether V1 can bring it back: started in the editor or in a terminal.
   * Elsewhere (SDK, unknown) V1 only explains it cannot — the row says so
   * instead of offering a click that leads nowhere.
   */
  resumable: boolean;
}

export interface Snapshot {
  /** When the host built it. */
  at: number;
  sessions: SessionView[];
  folders: FolderView[];
  /** Ids of the sessions in no folder, in display order. */
  unfiled: string[];
  usage?: UsageView;
  artifacts: { at: number; items: ArtifactView[] } | undefined;
  routines: { at: number; items: RoutineView[] } | undefined;
  closed: ClosedView[];
  settings: SettingsView;
  processes?: ProcessesView;
  activity?: ActivityView;
  /** The sheet of the conversation the cockpit shows, when it shows one. */
  sheet?: SessionSheetView;
  /** The editor's tab bar (workbench.editor.showTabs), for the settings. */
  editorTabs?: EditorTabs;
  /** The tidying agent: whether Refresh asks first, and the rules it follows. */
  tidy?: { ask: boolean; rules: string[] };
  /** Koh-Vibe's colours (theme.ts), the same in every view. */
  theme?: ThemeState;
  /** Whether the editor wears Koh-Vibe's colours (« Back to default » then undoes it). */
  ideThemed?: boolean;
}

export const SIDEBAR_TABS = ['sessions', 'artifacts', 'routines', 'processes', 'usage'] as const;
export type SidebarTab = (typeof SIDEBAR_TABS)[number];

export function isSidebarTab(v: unknown): v is SidebarTab {
  return typeof v === 'string' && (SIDEBAR_TABS as readonly string[]).includes(v);
}

/** Which surface the view is rendering in. */
export type Surface = 'sidebar' | 'cockpit';

export interface ViewContext {
  surface: Surface;
  /** The editor's display language, e.g. "fr" or "en-us". */
  language: string;
  /** The extension's version, shown beside the name. */
  version: string;
  /**
   * New at every start of the extension: a view that sees a different one
   * from the one it remembers starts with its folders folded (14/11), where
   * a mere reload of the view keeps them as they were.
   */
  launch: string;
  /** The language picked in the settings; `language` above is what it resolves to. */
  languageChoice: LanguageChoice;
}

/** Host → view. */
/**
 * What a click on a closed conversation led to. `v1`: V1 took it and the
 * conversation is on its way — the view waits for it to show up again.
 * Anything else: nothing is coming, and the view stops waiting at once.
 */
export const REOPEN_OUTCOMES = ['v1', 'unavailable', 'gone', 'failed'] as const;
export type ReopenOutcome = (typeof REOPEN_OUTCOMES)[number];

export type HostMessage =
  | { type: 'init'; context: ViewContext; snapshot: Snapshot }
  | { type: 'snapshot'; snapshot: Snapshot }
  | { type: 'reopen'; sessionId: string; outcome: ReopenOutcome }
  /** The answer to the view's `act` of the same `req`. */
  | { type: 'acted'; req: number; result: ActionResult }
  /** Opens a conversation's sheet in the cockpit (the sidebar's « sheet » button, or a click without V1). */
  | { type: 'showSheet'; sessionId: string };

/** View → host. */
export type ViewMessage =
  | { type: 'ready' }
  | { type: 'openCockpit'; sessionId?: string }
  | { type: 'reload' }
  /** The tab the view now shows: the host scans for orphan processes only behind the Processes one. */
  | { type: 'tab'; tab: SidebarTab }
  /**
   * Brings a conversation to the front. While V1 is installed the host hands
   * the click to V1's own command, which owns the acknowledgement it writes.
   */
  | { type: 'openSession'; sessionId: string }
  /** A click on a « Recently closed » row: handed to V1's resume, like openSession. */
  | { type: 'reopenClosed'; sessionId: string }
  /** Opens the artifact's page on claude.ai in the browser — a link, nothing written. */
  | { type: 'openArtifact'; slug: string }
  /** Which conversation's sheet the cockpit shows — `null` when none. The host builds only that one. */
  | { type: 'sheet'; sessionId: string | null }
  /** A change (actions.ts). `req` numbers it, so the answer finds its way back. */
  | { type: 'act'; req: number; action: Action };

/** claude.ai's slugs, as V1 accepts them (artifacts/model.ts): they end up in a URL. */
const SLUG = /^[A-Za-z0-9_-]{1,128}$/;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * The host does not trust what the view posts: a stale view left over from an
 * older build, or a typo on the view's side, must be dropped rather than
 * reach a command with a malformed payload.
 */
export function parseViewMessage(raw: unknown): ViewMessage | undefined {
  if (!isRecord(raw)) return undefined;
  switch (raw['type']) {
    case 'ready':
      return { type: 'ready' };
    case 'reload':
      return { type: 'reload' };
    case 'openSession': {
      const id = raw['sessionId'];
      return typeof id === 'string' && id.length > 0 ? { type: 'openSession', sessionId: id } : undefined;
    }
    case 'reopenClosed': {
      const id = raw['sessionId'];
      return typeof id === 'string' && id.length > 0 ? { type: 'reopenClosed', sessionId: id } : undefined;
    }
    case 'openArtifact': {
      const slug = raw['slug'];
      return typeof slug === 'string' && SLUG.test(slug) ? { type: 'openArtifact', slug } : undefined;
    }
    case 'sheet': {
      const id = raw['sessionId'];
      if (id === null) return { type: 'sheet', sessionId: null };
      return typeof id === 'string' && id.length > 0 && id.length <= 128 ? { type: 'sheet', sessionId: id } : undefined;
    }
    case 'act': {
      const req = raw['req'];
      const action = parseAction(raw['action']);
      return typeof req === 'number' && Number.isSafeInteger(req) && action !== undefined ? { type: 'act', req, action } : undefined;
    }
    case 'tab':
      return isSidebarTab(raw['tab']) ? { type: 'tab', tab: raw['tab'] } : undefined;
    case 'openCockpit': {
      const id = raw['sessionId'];
      if (id === undefined) return { type: 'openCockpit' };
      return typeof id === 'string' && id.length > 0 ? { type: 'openCockpit', sessionId: id } : undefined;
    }
    default:
      return undefined;
  }
}

/** Same rule the other way: the view drops what it does not recognise. */
export function isHostMessage(raw: unknown): raw is HostMessage {
  if (!isRecord(raw)) return false;
  const t = raw['type'];
  if (t === 'snapshot') return isRecord(raw['snapshot']);
  if (t === 'init') return isRecord(raw['snapshot']) && isRecord(raw['context']);
  if (t === 'showSheet') return typeof raw['sessionId'] === 'string';
  if (t === 'acted') return typeof raw['req'] === 'number' && isActionResult(raw['result']);
  if (t === 'reopen') return typeof raw['sessionId'] === 'string' && REOPEN_OUTCOMES.some((o) => o === raw['outcome']);
  return false;
}
