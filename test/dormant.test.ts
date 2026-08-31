import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { dormantSessions, mergeDormant, parseEditorMemento, readEditorMemento, shownSession, type ClaudeTab } from '../src/claude/dormant';
import type { Session } from '../src/events/types';

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
      { sessionId: ID_A, title: '#EDN monitoring', group: 0, index: 0 },
      // Index 2: the file tab in between counts, it is a tab of the group too.
      { sessionId: ID_B, title: 'Telegram Alert', group: 0, index: 2 },
    ]);
  });

  it('ranks the groups in grid order, so a tab can be found again in `tabGroups.all`', () => {
    const raw = JSON.stringify({
      'editorpart.state': {
        serializedGrid: {
          root: {
            type: 'branch',
            data: [
              { type: 'leaf', data: { id: 1, editors: [fileTab, claudeTab('left', ID_A)] } },
              { type: 'branch', data: [{ type: 'leaf', data: { id: 2, editors: [claudeTab('right', ID_B)] } }] },
            ],
          },
        },
      },
    });
    expect(parseEditorMemento(raw)).toEqual<ClaudeTab[]>([
      { sessionId: ID_A, title: 'left', group: 0, index: 1 },
      { sessionId: ID_B, title: 'right', group: 1, index: 0 },
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
    { sessionId: ID_A, title: '#EDN monitoring', group: 0, index: 0 },
    { sessionId: ID_B, title: 'Telegram Alert', group: 0, index: 1 },
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

describe('mergeDormant — a restored tab over the sessions on disk', () => {
  const base: Session = {
    id: ID_A, cwd: '/Users/dev/projet', project: 'projet', origin: 'vscode', status: 'idle', toolCount: 4, lastEventAt: 500,
  };
  const dormant: Session = { ...base, status: 'idle', toolCount: 0, lastEventAt: 0, dormant: true, title: 'from the tab' };

  it('adds a tab the spool does not know', () => {
    const map = new Map<string, Session>();
    mergeDormant(map, [dormant]);
    expect(map.get(ID_A)).toBe(dormant);
  });

  it('turns an ENDED row into a dormant one — the tab is right there — keeping what the file knows', () => {
    const map = new Map<string, Session>([[ID_A, { ...base, endedAt: 900, title: 'from the transcript' }]]);
    mergeDormant(map, [dormant]);
    const row = map.get(ID_A);
    expect(row).toMatchObject({ dormant: true, status: 'idle', toolCount: 4, lastEventAt: 500, title: 'from the transcript' });
    expect(row).not.toHaveProperty('endedAt');
  });

  it('takes the tab\'s title when the file has none', () => {
    const map = new Map<string, Session>([[ID_A, { ...base, endedAt: 900 }]]);
    mergeDormant(map, [dormant]);
    expect(map.get(ID_A)?.title).toBe('from the tab');
  });

  it('leaves an OPEN row alone: a process is the truth, a tab only its promise', () => {
    const open: Session = { ...base, status: 'running' };
    const map = new Map<string, Session>([[ID_A, open]]);
    mergeDormant(map, [dormant]);
    expect(map.get(ID_A)).toBe(open);
  });
});

// The rule the VIEW applies, pulled out so a command can apply the same one.
// It had lived only inside `mergeDormant`, and the divergence cost a bug: the
// row showed a conversation as awake — its tab restored by a window reload —
// while the moon read the raw state file, found it ended, and returned in
// silence. A row and the gesture on that row must agree on what they are.
describe('shownSession — what a row actually shows', () => {
  const onDisk = (over: Partial<Session> = {}): Session => ({
    id: 's1',
    cwd: '/Users/dev/projet',
    project: 'projet',
    origin: 'vscode',
    status: 'idle',
    toolCount: 0,
    lastEventAt: 42,
    ...over,
  });
  const restored = (over: Partial<Session> = {}): Session => onDisk({ dormant: true, lastEventAt: 0, ...over });

  it('wakes an ended conversation whose tab the editor restored — the tab is right there', () => {
    const shown = shownSession(onDisk({ endedAt: 10, title: 'du fichier' }), restored());
    expect(shown?.endedAt).toBeUndefined();
    expect(shown?.dormant).toBe(true);
    // Everything the file knew survives: only its end goes.
    expect(shown?.title).toBe('du fichier');
    expect(shown?.lastEventAt).toBe(42);
  });

  it('borrows the tab title only when the file has none', () => {
    expect(shownSession(onDisk({ endedAt: 10 }), restored({ title: 'de l onglet' }))?.title).toBe('de l onglet');
    expect(shownSession(onDisk({ endedAt: 10, title: 'du fichier' }), restored({ title: 'de l onglet' }))?.title).toBe(
      'du fichier',
    );
  });

  it('leaves an OPEN conversation alone — a process is the truth, a tab only a promise', () => {
    const open = onDisk();
    expect(shownSession(open, restored())).toBe(open);
  });

  it('shows the restored tab alone when the spool knows nothing of it', () => {
    const tab = restored();
    expect(shownSession(undefined, tab)).toBe(tab);
  });

  it('shows the file alone when this window restored no tab for it', () => {
    const file = onDisk({ endedAt: 10 });
    expect(shownSession(file, undefined)).toBe(file);
  });

  it('shows nothing when neither knows it', () => {
    expect(shownSession(undefined, undefined)).toBeUndefined();
  });
});
