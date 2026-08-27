import { execFile } from 'node:child_process';
import type { Session } from '../events/types';
import { branchOf, projectOf } from '../events/origin';
import { isValidSessionId } from '../events/parse';

/** A Claude Code panel as the editor persisted it: which conversation, under which title. */
export interface ClaudeTab {
  sessionId: string;
  title: string;
}

const WEBVIEW_INPUT = 'workbench.editors.webviewInput';
const CLAUDE_PANEL = 'claudeVSCodePanel';
const MEMENTO_KEY = 'memento/workbench.parts.editor';

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function parseJson(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

/**
 * The Claude Code panels found in the editor's memento of its editor area.
 *
 * VSCode persists the grid of editor groups, each editor as `{ id, value }`
 * with `value` a JSON string; a webview's value carries the `state` its
 * extension chose to keep, as a JSON string again. The Claude Code extension
 * keeps `{ sessionID }` there — that is how it resumes the conversation when
 * the tab is finally shown. Walked rather than addressed by path: the shape
 * of the grid is VSCode's business, and it nests as deep as the user split
 * the editor. Anything unreadable is simply not a tab.
 */
export function parseEditorMemento(raw: string): ClaudeTab[] {
  const root = parseJson(raw);
  const out: ClaudeTab[] = [];
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    if (!isRecord(node)) return;
    if (node['id'] === WEBVIEW_INPUT) {
      const tab = claudeTabOf(parseJson(node['value']));
      if (tab !== undefined) out.push(tab);
      return;
    }
    for (const value of Object.values(node)) walk(value);
  };
  walk(root);
  return out;
}

function claudeTabOf(value: unknown): ClaudeTab | undefined {
  if (!isRecord(value) || value['providedId'] !== CLAUDE_PANEL) return undefined;
  const state = parseJson(value['state']);
  if (!isRecord(state)) return undefined;
  const sessionId = state['sessionID'];
  const title = value['title'];
  if (typeof sessionId !== 'string' || !isValidSessionId(sessionId)) return undefined;
  return { sessionId, title: typeof title === 'string' ? title : '' };
}

/**
 * The raw memento, read out of the editor's state database with the
 * `sqlite3` that macOS ships — read-only, so that a database the editor is
 * writing to is never touched. Anything short of a value — no file, no table,
 * no row, a locked database — is `undefined`: no dormant tab to show, and
 * nothing to report. `execFile`, never `exec`: the path never crosses a shell.
 */
export function readEditorMemento(stateDb: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile(
      '/usr/bin/sqlite3',
      ['-readonly', stateDb, `select value from ItemTable where key='${MEMENTO_KEY}'`],
      { maxBuffer: 64 * 1024 * 1024 },
      (err, stdout) => {
        if (err) return resolve(undefined);
        const value = stdout.replace(/\n$/, '');
        resolve(value.length > 0 ? value : undefined);
      },
    );
  });
}

/**
 * The conversations that exist only as a tab: restored by the editor, never
 * shown since, hence without a process — and unknown to the hooks and to the
 * registry alike. Shown so that the list matches the tab bar, and woken by a
 * click like any other conversation of this editor.
 *
 * Two filters, both necessary. `liveLabels` are the titles of the Claude tabs
 * open in this window right now: the memento is persisted state, and a tab
 * closed a moment ago may still be in it. `known` are the ids that have a
 * process or a state file: those are real sessions, and the real one wins.
 *
 * Dated zero on purpose: nothing has happened, and the labels say "tab not
 * started" instead of an age. It also sorts the dormant rows last.
 */
export function dormantSessions(
  tabs: readonly ClaudeTab[],
  liveLabels: ReadonlySet<string>,
  known: ReadonlySet<string>,
  cwd: string,
): Session[] {
  const out: Session[] = [];
  const seen = new Set<string>();
  for (const tab of tabs) {
    if (seen.has(tab.sessionId) || known.has(tab.sessionId) || !liveLabels.has(tab.title)) continue;
    seen.add(tab.sessionId);
    const session: Session = {
      id: tab.sessionId,
      cwd,
      project: projectOf(cwd),
      origin: 'vscode',
      status: 'idle',
      toolCount: 0,
      lastEventAt: 0,
      dormant: true,
    };
    const branch = branchOf(cwd);
    if (branch !== undefined) session.branch = branch;
    if (tab.title.length > 0) session.title = tab.title;
    out.push(session);
  }
  return out;
}
