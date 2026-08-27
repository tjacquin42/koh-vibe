import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { dormantSessions, parseEditorMemento, readEditorMemento, type ClaudeTab } from '../src/claude/dormant';

/**
 * The editor's memento, as VSCode persists it: the grid of editor groups, each
 * editor an `{ id, value }` pair whose `value` is a JSON string, and inside a
 * Claude panel's value a `state` that is a JSON string again — with the
 * session id the Claude Code extension put there for its own restore.
 */
function memento(editors: Array<Record<string, unknown>>): string {
  return JSON.stringify({
    'editorpart.state': {
      serializedGrid: {
        root: { type: 'branch', data: [{ type: 'leaf', data: { id: 3, editors } }] },
        orientation: 1,
      },
    },
  });
}

const claudeTab = (title: string, sessionID: string | undefined, providedId = 'claudeVSCodePanel') => ({
  id: 'workbench.editors.webviewInput',
  value: JSON.stringify({
    origin: '73dfea24-b595-4bf5-bd4e-5a1ef64a96ff',
    viewType: `mainThreadWebview-${providedId}`,
    providedId,
    title,
    state: sessionID === undefined ? undefined : JSON.stringify({ isFullEditor: false, sessionID }),
  }),
});

const fileTab = { id: 'workbench.editors.files.fileEditorInput', value: JSON.stringify({ resourceJSON: { path: '/Users/dev/projet/a.ts' } }) };

const ID_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ID_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

describe('parseEditorMemento', () => {
  it('finds every Claude panel with its session id and title, and nothing else', () => {
    const raw = memento([claudeTab('#EDN monitoring', ID_A), fileTab, claudeTab('Telegram Alert', ID_B)]);
    expect(parseEditorMemento(raw)).toEqual<ClaudeTab[]>([
      { sessionId: ID_A, title: '#EDN monitoring' },
      { sessionId: ID_B, title: 'Telegram Alert' },
    ]);
  });

  it('skips a panel without a usable session id, and other webviews', () => {
    const raw = memento([claudeTab('no state', undefined), claudeTab('bad id', '../etc'), claudeTab('other', ID_A, 'somethingElse')]);
    expect(parseEditorMemento(raw)).toEqual([]);
  });

  it('reads garbage as no tab at all, never as an error', () => {
    expect(parseEditorMemento('not json')).toEqual([]);
    expect(parseEditorMemento('{}')).toEqual([]);
    expect(parseEditorMemento(memento([{ id: 'workbench.editors.webviewInput', value: '{ broken' }]))).toEqual([]);
  });
});

describe('dormantSessions', () => {
  const tabs: ClaudeTab[] = [
    { sessionId: ID_A, title: '#EDN monitoring' },
    { sessionId: ID_B, title: 'Telegram Alert' },
  ];

  it('turns a restored tab that nobody has woken into a dormant session, filed by id', () => {
    const out = dormantSessions(tabs, new Set(['#EDN monitoring', 'Telegram Alert']), new Set([ID_B]), '/Users/dev/projet');
    expect(out).toEqual([
      {
        id: ID_A, cwd: '/Users/dev/projet', project: 'projet', origin: 'vscode', status: 'idle',
        toolCount: 0, lastEventAt: 0, title: '#EDN monitoring', dormant: true,
      },
    ]);
  });

  it('drops a tab that is not open in this window any more, and one whose session is known', () => {
    expect(dormantSessions(tabs, new Set(['Telegram Alert']), new Set([ID_B]), '/Users/dev/projet')).toEqual([]);
  });

  it('reads the branch off a worktree path like every other session', () => {
    const out = dormantSessions(tabs, new Set(['#EDN monitoring']), new Set(), '/Users/dev/projet/.worktrees/feat-x');
    expect(out[0]?.project).toBe('projet');
    expect(out[0]?.branch).toBe('feat-x');
  });
});

describe('readEditorMemento', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'koh-memento-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('reads the editor memento out of the editor state database', async () => {
    const db = join(dir, 'state.vscdb');
    execFileSync('/usr/bin/sqlite3', [
      db,
      "create table ItemTable(key text primary key, value blob); insert into ItemTable values('memento/workbench.parts.editor', '{\"editorpart.state\":{}}'), ('other', 'x');",
    ]);
    expect(await readEditorMemento(db)).toBe('{"editorpart.state":{}}');
  });

  it('answers undefined for a missing database or a missing memento', async () => {
    expect(await readEditorMemento(join(dir, 'absent.vscdb'))).toBeUndefined();
    const db = join(dir, 'empty.vscdb');
    execFileSync('/usr/bin/sqlite3', [db, 'create table ItemTable(key text primary key, value blob);']);
    expect(await readEditorMemento(db)).toBeUndefined();
  });
});
