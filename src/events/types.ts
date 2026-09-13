export type Status = 'running' | 'waiting' | 'done_unseen' | 'idle';
export type Origin = 'vscode' | 'terminal' | 'desktop' | 'sdk' | 'unknown';

export const HOOK_EVENTS = [
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'PermissionRequest',
  'Notification',
  'Stop',
  'SessionEnd',
] as const;
export type HookEvent = (typeof HOOK_EVENTS)[number];

/** Events produced by the extension itself, dropped into the same spool. */
export const LOCAL_EVENTS = ['Ack'] as const;
export type LocalEvent = (typeof LOCAL_EVENTS)[number];

export type EventName = HookEvent | LocalEvent;

/** Normalized event: the reducer never sees a raw payload. */
export interface SpoolEvent {
  event: EventName;
  at: number;
  entrypoint: string;
  termProgram: string;
  sessionId: string;
  cwd: string;
  transcriptPath?: string;
  toolName?: string;
  toolTarget?: string;
  message?: string;
  /**
   * The subagent that made this tool call, when one did.
   *
   * Claude Code puts `agent_id` and `agent_type` on the calls a subagent
   * makes, under the PARENT conversation's session id; a call the
   * conversation makes itself carries neither. Absent here therefore means
   * "the conversation did this", not "unknown".
   */
  agentId?: string;
  agentType?: string;
}

export interface Session {
  id: string;
  cwd: string;
  project: string;
  branch?: string;
  /** The conversation's title, read from the transcript. Absent until Claude has set one. */
  title?: string;
  origin: Origin;
  status: Status;
  currentAction?: { tool: string; target?: string };
  pendingPermission?: { tool: string; summary: string };
  /** Set on PreToolUse, cleared on PostToolUse. Suspends expiry. */
  inFlightSince?: number;
  toolCount: number;
  tokens?: { input: number; output: number };
  startedAt?: number;
  lastEventAt: number;
  transcriptPath?: string;
  /**
   * When the conversation ended — its tab closed, its process gone
   * (`SessionEnd`). An ended conversation stays on the list, greyed and in its
   * folder, until the user removes it or the cap on ended ones drops it; a
   * click brings it back, and any hook clears the mark.
   */
  endedAt?: number;
  /**
   * Taken off the list by the user ("Remove from the list") while its process
   * still runs. Kept on disk so that a rescan does not bring it straight back;
   * cleared by the next hook, which is the activity the user removed it for
   * lack of.
   */
  hidden?: true;
  /**
   * A tab the editor restored and nobody has opened since: no process, no
   * registry entry, no hook — known only from the editor's own persisted
   * state. Never written to the spool; lives in the memory of the window that
   * holds the tab. A click wakes it, and a real session takes its place.
   */
  dormant?: true;
}
