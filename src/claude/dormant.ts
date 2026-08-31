import { execFile } from 'node:child_process';
import type { Session } from '../events/types';
import { branchOf, projectOf } from '../events/origin';
import { isValidSessionId } from '../events/parse';

/** A Claude Code panel as the editor persisted it: which conversation, under which title. */
export interface ClaudeTab {
  sessionId: string;
  title: string;
  /** The editor group's rank in the grid — left to right, top to bottom — as `tabGroups.all` orders them. */
  group: number;
  /** The tab's index in that group. */
  index: number;
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
  // Leaves are met in grid order, which is the order of `tabGroups.all` and
  // of the view columns: the rank is what lets a tab be found again.
  let group = 0;
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    if (!isRecord(node)) return;
    const data = node['data'];
    if (node['type'] === 'leaf' && isRecord(data) && Array.isArray(data['editors'])) {
      const rank = group;
      group += 1;
      data['editors'].forEach((editor: unknown, index: number) => {
        if (!isRecord(editor) || editor['id'] !== WEBVIEW_INPUT) return;
        const tab = claudeTabOf(parseJson(editor['value']), rank, index);
        if (tab !== undefined) out.push(tab);
      });
      return;
    }
    for (const value of Object.values(node)) walk(value);
  };
  walk(root);
  return out;
}

function claudeTabOf(value: unknown, group: number, index: number): ClaudeTab | undefined {
  if (!isRecord(value) || value['providedId'] !== CLAUDE_PANEL) return undefined;
  const state = parseJson(value['state']);
  if (!isRecord(state)) return undefined;
  const sessionId = state['sessionID'];
  const title = value['title'];
  if (typeof sessionId !== 'string' || !isValidSessionId(sessionId)) return undefined;
  return { sessionId, title: typeof title === 'string' ? title : '', group, index };
}

/**
 * The raw memento, read out of the editor's state database with the
 * `sqlite3` that macOS ships — read-only, so that a database the editor is
 * writing to is never touched. Anything short of a value — no file, no table,
 * no row, a locked database — is `undefined`: no dormant tab to show, and
 * nothing to report. `execFile`, never `exec`: the path never crosses a shell.
 */
export function readEditorMemento(stateDb: string): Promise<string | undefined> {
  return readStateItem(stateDb, MEMENTO_KEY);
}

/**
 * One value of the editor's state database, by key — the memento above, or an
 * extension's global state (`claude/listed.ts`). Keys come from this code,
 * never from the outside, and are checked all the same before they meet SQL.
 */
export function readStateItem(stateDb: string, key: string): Promise<string | undefined> {
  if (!/^[A-Za-z0-9./_-]+$/.test(key)) return Promise.resolve(undefined);
  return new Promise((resolve) => {
    execFile(
      '/usr/bin/sqlite3',
      ['-readonly', stateDb, `select value from ItemTable where key='${key}'`],
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
/**
 * Lays this window's dormant tabs over the sessions on disk. An unknown one is
 * added. A known one that has ENDED is shown as dormant instead: its tab is
 * right there in the tab bar — the editor restored it and nobody has opened it
 * since — so it is a conversation to wake, not a closed one. The row keeps
 * everything the file knows (folder, title, counters); only its end goes,
 * for this window and this render. An open one is left alone: a process is
 * the truth about a conversation, a tab is only its promise.
 */
export function mergeDormant(map: Map<string, Session>, dormant: Iterable<Session>): void {
  for (const d of dormant) {
    const next = shownSession(map.get(d.id), d);
    if (next !== undefined) map.set(d.id, next);
  }
}

/**
 * The rule above, for ONE conversation — and the reason it is exported.
 *
 * A row shows the result of this; anything acting ON that row has to read the
 * same thing, or the two disagree about what the user clicked. They did: after
 * an editor restart, a conversation whose file was marked ended but whose tab
 * had been restored showed as awake, while the moon read the raw file, found
 * an end, and returned without a word. The rule now has one home.
 */
export function shownSession(onDisk: Session | undefined, restored: Session | undefined): Session | undefined {
  if (restored === undefined) return onDisk;
  if (onDisk === undefined) return restored;
  if (onDisk.endedAt === undefined) return onDisk;
  const { endedAt: _over, ...rest } = onDisk;
  const next: Session = { ...rest, status: 'idle', dormant: true };
  if (next.title === undefined && restored.title !== undefined) next.title = restored.title;
  return next;
}

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
