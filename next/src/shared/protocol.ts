/**
 * The contract between the extension host and the web view.
 *
 * Shared by both sides and imported by both bundles, so it must stay free of
 * any runtime dependency: plain types plus the two guards below. The view
 * never sees the V1 types themselves — the host maps them to these shapes,
 * which keeps the view's bundle free of `node:` and `vscode` imports and lets
 * the on-disk format evolve without touching the UI.
 */

export type SessionStatus = 'running' | 'waiting' | 'done_unseen' | 'idle';
export type SessionOrigin = 'vscode' | 'terminal' | 'desktop' | 'sdk' | 'unknown';

export interface SessionView {
  id: string;
  /** Claude's title for the conversation, absent until it has set one. */
  title?: string;
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
  resetsAt?: number;
}

export interface UsageView {
  at: number;
  source: 'api' | 'statusline';
  fiveHour?: UsageWindowView;
  weekly?: UsageWindowView;
}

export interface ArtifactView {
  slug: string;
  title: string;
  updatedAt?: number;
  pinned: boolean;
}

export interface RoutineView {
  id: string;
  name: string;
  enabled: boolean;
  nextRunAt?: number;
}

export interface ClosedView {
  sessionId: string;
  title?: string;
  project: string;
  closedAt: number;
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
}

/** Which surface the view is rendering in. */
export type Surface = 'sidebar' | 'cockpit';

export interface ViewContext {
  surface: Surface;
  /** The editor's display language, e.g. "fr" or "en-us". */
  language: string;
  /** The extension's version, for the footer. */
  version: string;
}

/** Host → view. */
export type HostMessage =
  | { type: 'init'; context: ViewContext; snapshot: Snapshot }
  | { type: 'snapshot'; snapshot: Snapshot };

/** View → host. */
export type ViewMessage =
  | { type: 'ready' }
  | { type: 'openCockpit'; sessionId?: string }
  | { type: 'reload' };

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
  return false;
}
