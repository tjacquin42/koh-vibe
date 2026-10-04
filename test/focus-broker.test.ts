import { mkdtempSync, rmSync } from 'node:fs';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { spoolDirs, type SpoolDirs } from '../src/paths';
import { ensureDirs } from '../src/spool/persist';
import { FocusBroker } from '../src/focus/broker';
import type { Session } from '../src/events/types';
import type { ClosedEntry } from '../src/closed/model';

const session = (over: Partial<Session> = {}): Session => ({
  id: 's1',
  cwd: '/Users/dev/projet',
  project: 'projet',
  branch: 'feat-x',
  origin: 'vscode',
  status: 'done_unseen',
  toolCount: 0,
  lastEventAt: 0,
  ...over,
});

let home: string;
let dirs: SpoolDirs;
// An unclaimed `request()` arms a fallback timer at a real 2s: without
// stop(), it would outlive the test and could actually run `code -r` once
// the test is over. Every broker created by a test registers here so it can
// be stopped, exception-free, in afterEach.
let brokers: FocusBroker[];

interface CloseCalls {
  closeHere: string[];
  sleepHere: string[];
  forget: string[];
}

let closeCalls: CloseCalls;
// What this window's Claude Code session list answers (claude/listed.ts).
let listed = true;

let opened: string[] = [];

function makeBroker(): FocusBroker {
  const b = new FocusBroker(
    dirs,
    {
      closeHere: async (id: string) => {
        closeCalls.closeHere.push(id);
      },
      sleepHere: async (id: string) => {
        closeCalls.sleepHere.push(id);
      },
      forget: async (id: string) => {
        closeCalls.forget.push(id);
      },
    },
    async () => listed,
    (sessionId) => opened.push(sessionId),
  );
  brokers.push(b);
  return b;
}

/**
 * Sets the workspace folders on the `vscode` stub.
 *
 * The real API exposes them as READ-ONLY, and that is exactly what the
 * type-checker works against — a stub that diverged from its signatures
 * would no longer prove anything. This narrow view therefore says exactly
 * what we are forcing, and nothing more: the day the API's shape changes,
 * the line breaks here.
 */
function setWorkspaceFolders(folders: readonly { uri: { fsPath: string } }[] | undefined): void {
  (vscode.workspace as { workspaceFolders?: unknown }).workspaceFolders = folders;
}

beforeEach(async () => {
  listed = true;
  home = mkdtempSync(join(tmpdir(), 'koh-broker-'));
  dirs = spoolDirs(home);
  await ensureDirs(dirs);
  setWorkspaceFolders(undefined);
  vi.restoreAllMocks();
  brokers = [];
  closeCalls = { closeHere: [], sleepHere: [], forget: [] };
  opened = [];
});

afterEach(() => {
  for (const b of brokers) b.stop();
  rmSync(home, { recursive: true, force: true });
});

describe('FocusBroker.request', () => {
  it('reveals the session\'s panel (by its id) when the current window claims it', async () => {
    setWorkspaceFolders([{ uri: { fsPath: '/Users/dev/projet' } }]);
    const executeCommand = vi.spyOn(vscode.commands, 'executeCommand').mockResolvedValue(undefined);
    const broker = makeBroker();

    await broker.request(session({ id: 'sess-1' }));

    expect(executeCommand).toHaveBeenCalledWith('claude-vscode.editor.open', 'sess-1');
  });

  it("executes no command for a terminal session claimed locally — it explains instead", async () => {
    setWorkspaceFolders([{ uri: { fsPath: '/Users/dev/projet' } }]);
    const executeCommand = vi.spyOn(vscode.commands, 'executeCommand').mockResolvedValue(undefined);
    const showInformationMessage = vi.spyOn(vscode.window, 'showInformationMessage').mockResolvedValue(undefined);
    const broker = makeBroker();

    await broker.request(session({ origin: 'terminal' }));

    expect(executeCommand).not.toHaveBeenCalled();
    expect(showInformationMessage).toHaveBeenCalled();
  });

  it("writes a request file carrying the session's label and origin when no window claims it", async () => {
    const broker = makeBroker();

    await broker.request(session({ id: 's-remote', branch: 'feat-x', origin: 'vscode' }));

    const raw = await readFile(join(dirs.requests, 'focus-s-remote.json'), 'utf8');
    const parsed = JSON.parse(raw) as { sessionId: string; cwd: string; label: string; origin: string };
    expect(parsed.sessionId).toBe('s-remote');
    expect(parsed.label).toBe('projet · feat-x'); // sessionLabel() falls back to project · branch with no title
    expect(parsed.origin).toBe('vscode');
  });
});

describe('FocusBroker — consuming requests (I3)', () => {
  it("focuses without waiting for the information message to close", async () => {
    // A real showInformationMessage only settles when the toast closes:
    // simulated here by a promise that never settles. If the broker were
    // still awaiting it before focusing (bug I3), the call below to
    // consume() would never finish and this test would time out on vitest's
    // default delay — driven by the real chaining of promises, never by a
    // timer added for the occasion.
    let messageCalled = false;
    let focusCalled = false;
    vi.spyOn(vscode.window, 'showInformationMessage').mockImplementation(() => {
      messageCalled = true;
      return new Promise<undefined>(() => undefined);
    });
    vi.spyOn(vscode.commands, 'executeCommand').mockImplementation(async () => {
      focusCalled = true;
      return undefined;
    });
    setWorkspaceFolders([{ uri: { fsPath: '/Users/dev/projet' } }]);

    // The request is written while no one claims it yet (empty folder), to
    // force writing a file rather than a direct focus.
    setWorkspaceFolders(undefined);
    const other = makeBroker();
    await other.request(session({ id: 's-cross' }));

    setWorkspaceFolders([{ uri: { fsPath: '/Users/dev/projet' } }]);
    const broker = makeBroker();
    const internal = broker as unknown as { consume: () => Promise<void> };
    await internal.consume();

    expect(messageCalled).toBe(true);
    expect(focusCalled).toBe(true);
  });

  it('names the session in the message rather than staying generic (minor T11)', async () => {
    let message: unknown;
    vi.spyOn(vscode.window, 'showInformationMessage').mockImplementation((m: string) => {
      message = m;
      return new Promise<undefined>(() => undefined);
    });
    vi.spyOn(vscode.commands, 'executeCommand').mockResolvedValue(undefined);

    const other = makeBroker();
    await other.request(session({ id: 's-cross', branch: 'feat-x' }));

    setWorkspaceFolders([{ uri: { fsPath: '/Users/dev/projet' } }]);
    const broker = makeBroker();
    const internal = broker as unknown as { consume: () => Promise<void> };
    await internal.consume();

    expect(typeof message).toBe('string');
    expect(message as string).toContain('feat-x');
  });

  it('ignores a request that the current window does not claim', async () => {
    vi.spyOn(vscode.window, 'showInformationMessage').mockResolvedValue(undefined);
    const executeCommand = vi.spyOn(vscode.commands, 'executeCommand').mockResolvedValue(undefined);

    const other = makeBroker();
    await other.request(session({ id: 's-cross' }));

    setWorkspaceFolders([{ uri: { fsPath: '/Users/dev/autre-projet' } }]);
    const broker = makeBroker();
    const internal = broker as unknown as { consume: () => Promise<void> };
    await internal.consume();

    expect(executeCommand).not.toHaveBeenCalled();
  });

  it('receives exactly the reveal command, with the session id as argument', async () => {
    vi.spyOn(vscode.window, 'showInformationMessage').mockResolvedValue(undefined);
    const executeCommand = vi.spyOn(vscode.commands, 'executeCommand').mockResolvedValue(undefined);

    const other = makeBroker();
    await other.request(session({ id: 'sess-1', origin: 'vscode' }));

    setWorkspaceFolders([{ uri: { fsPath: '/Users/dev/projet' } }]);
    const broker = makeBroker();
    const internal = broker as unknown as { consume: () => Promise<void> };
    await internal.consume();

    expect(executeCommand).toHaveBeenCalledWith('claude-vscode.editor.open', 'sess-1');
  });

  it("shows only a single message for a remote non-editor session — the announcement and the explanation must not contradict each other", async () => {
    const showInformationMessage = vi.spyOn(vscode.window, 'showInformationMessage').mockResolvedValue(undefined);
    vi.spyOn(vscode.commands, 'executeCommand').mockResolvedValue(undefined);

    const other = makeBroker();
    await other.request(session({ id: 's-term', origin: 'terminal' }));

    setWorkspaceFolders([{ uri: { fsPath: '/Users/dev/projet' } }]);
    const broker = makeBroker();
    const internal = broker as unknown as { consume: () => Promise<void> };
    await internal.consume();

    expect(showInformationMessage).toHaveBeenCalledTimes(1);
  });

  it("executes no command for a terminal session consumed remotely", async () => {
    vi.spyOn(vscode.window, 'showInformationMessage').mockResolvedValue(undefined);
    const executeCommand = vi.spyOn(vscode.commands, 'executeCommand').mockResolvedValue(undefined);

    const other = makeBroker();
    await other.request(session({ id: 's-term', origin: 'terminal' }));

    setWorkspaceFolders([{ uri: { fsPath: '/Users/dev/projet' } }]);
    const broker = makeBroker();
    const internal = broker as unknown as { consume: () => Promise<void> };
    await internal.consume();

    expect(executeCommand).not.toHaveBeenCalled();
  });

  it("executes no command for a request with no origin field (written by an earlier version)", async () => {
    vi.spyOn(vscode.window, 'showInformationMessage').mockResolvedValue(undefined);
    const executeCommand = vi.spyOn(vscode.commands, 'executeCommand').mockResolvedValue(undefined);

    await writeFile(
      join(dirs.requests, 'focus-s-legacy.json'),
      JSON.stringify({ sessionId: 's-legacy', cwd: '/Users/dev/projet', label: 'projet · feat-x', at: Date.now() }),
      'utf8',
    );

    setWorkspaceFolders([{ uri: { fsPath: '/Users/dev/projet' } }]);
    const broker = makeBroker();
    const internal = broker as unknown as { consume: () => Promise<void> };
    await internal.consume();

    expect(executeCommand).not.toHaveBeenCalled();
  });
});

describe('requestReopen', () => {
  const entry = (over: Partial<ClosedEntry> = {}): ClosedEntry => ({
    id: 's1',
    cwd: '/Users/dev/projet',
    project: 'projet',
    origin: 'vscode',
    closedAt: 0,
    ...over,
  });

  it('reopens straight away when this window claims the folder', async () => {
    setWorkspaceFolders([{ uri: { fsPath: '/Users/dev/projet' } }]);
    const run = vi.spyOn(vscode.commands, 'executeCommand').mockResolvedValue(undefined);
    await makeBroker().requestReopen(entry());
    expect(run).toHaveBeenCalledWith('claude-vscode.editor.open', 's1');
    expect(await readdir(dirs.requests)).toEqual([]);
  });

  it('opens a terminal instead of the command when this window\'s session list does not hold the id — the command would start a blank conversation', async () => {
    setWorkspaceFolders([{ uri: { fsPath: '/Users/dev/projet' } }]);
    listed = false;
    const run = vi.spyOn(vscode.commands, 'executeCommand').mockResolvedValue(undefined);
    const sendText = vi.fn();
    const terminal = vi
      .spyOn(vscode.window, 'createTerminal')
      .mockReturnValue({ sendText, show: vi.fn() } as unknown as vscode.Terminal);
    await makeBroker().requestReopen(entry());
    expect(run).not.toHaveBeenCalledWith('claude-vscode.editor.open', 's1');
    expect(terminal).toHaveBeenCalledWith({ cwd: '/Users/dev/projet', name: 'projet' });
    expect(sendText).toHaveBeenCalledWith('claude --resume s1');
    expect(await readdir(dirs.requests)).toEqual([]);
  });

  it('consumes a reopen request for an editor conversation its list does not hold by opening a terminal here', async () => {
    setWorkspaceFolders([{ uri: { fsPath: '/Users/dev/projet' } }]);
    listed = false;
    const run = vi.spyOn(vscode.commands, 'executeCommand').mockResolvedValue(undefined);
    const sendText = vi.fn();
    vi.spyOn(vscode.window, 'createTerminal').mockReturnValue({ sendText, show: vi.fn() } as unknown as vscode.Terminal);
    await writeFile(
      join(dirs.requests, 'reopen-s9.json'),
      JSON.stringify({ sessionId: 's9', cwd: '/Users/dev/projet', label: 'projet', origin: 'vscode', at: Date.now() }),
      'utf8',
    );
    const broker = makeBroker();
    broker.start();
    await vi.waitFor(() => {
      expect(sendText).toHaveBeenCalledWith('claude --resume s9');
    });
    expect(run).not.toHaveBeenCalledWith('claude-vscode.editor.open', 's9');
    expect(await readdir(dirs.requests)).toEqual([]);
  });

  it('writes a request when another window holds the folder', async () => {
    setWorkspaceFolders([{ uri: { fsPath: '/Users/dev/autre' } }]);
    await makeBroker().requestReopen(entry());
    expect(await readdir(dirs.requests)).toEqual(['reopen-s1.json']);
  });

  it('does nothing for a terminal-origin entry, and never writes a request — the caller opens the terminal locally', async () => {
    setWorkspaceFolders([{ uri: { fsPath: '/Users/dev/autre' } }]);
    await makeBroker().requestReopen(entry({ origin: 'terminal' }));
    expect(await readdir(dirs.requests)).toEqual([]);
  });

  it('consumes a reopen request written for a folder it holds', async () => {
    setWorkspaceFolders([{ uri: { fsPath: '/Users/dev/projet' } }]);
    const run = vi.spyOn(vscode.commands, 'executeCommand').mockResolvedValue(undefined);
    await writeFile(
      join(dirs.requests, 'reopen-s9.json'),
      JSON.stringify({ sessionId: 's9', cwd: '/Users/dev/projet', label: 'projet', origin: 'vscode', at: Date.now() }),
      'utf8',
    );
    const broker = makeBroker();
    broker.start();
    await vi.waitFor(async () => {
      expect(run).toHaveBeenCalledWith('claude-vscode.editor.open', 's9');
    });
    expect(await readdir(dirs.requests)).toEqual([]);
  });

  it('ignores a reopen request that carries a terminal origin', async () => {
    setWorkspaceFolders([{ uri: { fsPath: '/Users/dev/projet' } }]);
    const terminal = vi.spyOn(vscode.window, 'createTerminal');
    await writeFile(
      join(dirs.requests, 'reopen-s9.json'),
      JSON.stringify({ sessionId: 's9', cwd: '/Users/dev/projet', label: 'projet', origin: 'terminal', at: Date.now() }),
      'utf8',
    );
    const broker = makeBroker();
    broker.start();
    await vi.waitFor(async () => {
      expect(await readdir(dirs.requests)).toEqual([]);
    });
    expect(terminal).not.toHaveBeenCalled();
  });

  it('explains rather than staying silent for an origin reopenPlan cannot turn into a command, even when this window holds the folder', async () => {
    setWorkspaceFolders([{ uri: { fsPath: '/Users/dev/projet' } }]);
    const info = vi.spyOn(vscode.window, 'showInformationMessage').mockResolvedValue(undefined);
    const run = vi.spyOn(vscode.commands, 'executeCommand').mockResolvedValue(undefined);
    await makeBroker().requestReopen(entry({ origin: 'sdk' }));
    expect(info).toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
    expect(await readdir(dirs.requests)).toEqual([]);
  });

  it('explains locally rather than writing a request when no window holds the folder either, since no window could reopen this origin', async () => {
    setWorkspaceFolders([{ uri: { fsPath: '/Users/dev/autre' } }]);
    const info = vi.spyOn(vscode.window, 'showInformationMessage').mockResolvedValue(undefined);
    const run = vi.spyOn(vscode.commands, 'executeCommand').mockResolvedValue(undefined);
    await makeBroker().requestReopen(entry({ origin: 'unknown' }));
    expect(info).toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
    expect(await readdir(dirs.requests)).toEqual([]);
  });

  it('warns instead of leaving a rejection unhandled when the editor command is missing on the local path', async () => {
    setWorkspaceFolders([{ uri: { fsPath: '/Users/dev/projet' } }]);
    vi.spyOn(vscode.commands, 'executeCommand').mockRejectedValue(new Error('no such command'));
    const warn = vi.spyOn(vscode.window, 'showWarningMessage').mockResolvedValue(undefined);
    await expect(makeBroker().requestReopen(entry())).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });

  it('does not let a warning already shown for focus suppress the one reopen deserves — the flags are separate', async () => {
    setWorkspaceFolders([{ uri: { fsPath: '/Users/dev/projet' } }]);
    vi.spyOn(vscode.commands, 'executeCommand').mockRejectedValue(new Error('no such command'));
    const warn = vi.spyOn(vscode.window, 'showWarningMessage').mockResolvedValue(undefined);
    const broker = makeBroker();

    // Two focus clicks: the first warns, the second stays silent — same cause,
    // already told.
    await broker.request(session());
    await broker.request(session());
    expect(warn).toHaveBeenCalledTimes(1);

    // A reopen click is a DIFFERENT gesture: it must still warn once, on its
    // own flag, rather than inheriting the focus one's silence.
    await broker.requestReopen(entry());
    expect(warn).toHaveBeenCalledTimes(2);
  });
});

describe('requestClose', () => {
  it('closes here, without writing any request, when this window holds the folder', async () => {
    setWorkspaceFolders([{ uri: { fsPath: '/Users/dev/projet' } }]);
    const broker = makeBroker();

    await broker.requestClose(session());

    expect(closeCalls.closeHere).toEqual(['s1']);
    expect(await readdir(dirs.requests)).toEqual([]);
  });

  it('writes a close request carrying the origin when another window holds the folder', async () => {
    const broker = makeBroker();

    await broker.requestClose(session());

    const body: unknown = JSON.parse(await readFile(join(dirs.requests, 'close-s1.json'), 'utf8'));
    expect(body).toMatchObject({ sessionId: 's1', cwd: '/Users/dev/projet', origin: 'vscode' });
    expect(closeCalls.closeHere).toEqual([]);
  });

  it('removes the row when no window consumes the request — no window open means no tab to close', async () => {
    vi.useFakeTimers();
    try {
      const broker = makeBroker();
      await broker.requestClose(session());

      await vi.advanceTimersByTimeAsync(2_000);
      // The fallback reads, unlinks then forgets, all asynchronously.
      await vi.waitFor(() => expect(closeCalls.forget).toEqual(['s1']));
      expect(await readdir(dirs.requests)).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('consumes a close request written for a folder it holds', async () => {
    const other = makeBroker();
    await other.requestClose(session({ id: 's-cross' }));

    setWorkspaceFolders([{ uri: { fsPath: '/Users/dev/projet' } }]);
    const broker = makeBroker();
    const internal = broker as unknown as { consume: () => Promise<void> };
    await internal.consume();

    expect(closeCalls.closeHere).toEqual(['s-cross']);
    expect(await readdir(dirs.requests)).toEqual([]);
  });

  it('discards a close request that does not carry an editor origin, and closes nothing', async () => {
    await writeFile(
      join(dirs.requests, 'close-s-term.json'),
      JSON.stringify({ sessionId: 's-term', cwd: '/Users/dev/projet', label: 'projet', origin: 'terminal', at: Date.now() }),
      'utf8',
    );

    setWorkspaceFolders([{ uri: { fsPath: '/Users/dev/projet' } }]);
    const broker = makeBroker();
    const internal = broker as unknown as { consume: () => Promise<void> };
    await internal.consume();

    expect(closeCalls.closeHere).toEqual([]);
    expect(await readdir(dirs.requests)).toEqual([]);
  });

  it('shows an error rather than dying silently when a consumed close request fails to close, and never falls through to the focus path', async () => {
    const showError = vi.spyOn(vscode.window, 'showErrorMessage').mockResolvedValue(undefined);
    const executeCommand = vi.spyOn(vscode.commands, 'executeCommand').mockResolvedValue(undefined);

    const other = makeBroker();
    await other.requestClose(session({ id: 's-cross' }));

    setWorkspaceFolders([{ uri: { fsPath: '/Users/dev/projet' } }]);
    const failing = new FocusBroker(dirs, {
      closeHere: async () => {
        throw new Error('archive write failed');
      },
      sleepHere: async () => undefined,
      forget: async () => undefined,
    }, async () => true);
    brokers.push(failing);
    const internal = failing as unknown as { consume: () => Promise<void> };
    await internal.consume();

    expect(showError).toHaveBeenCalled();
    expect(executeCommand).not.toHaveBeenCalled();
  });
});

// Going to sleep travels over the same rail as closing, and its only
// divergence is the fallback: a close that nobody consumes concludes
// « no window, therefore no tab » and removes the row; a sleep concludes the
// same thing and touches nothing, since there is no tab to close.
describe('requestSleep', () => {
  it('sleeps here, without writing a request, when this window holds the folder', async () => {
    setWorkspaceFolders([{ uri: { fsPath: '/Users/dev/projet' } }]);
    const broker = makeBroker();

    await broker.requestSleep(session());

    expect(closeCalls.sleepHere).toEqual(['s1']);
    expect(await readdir(dirs.requests)).toEqual([]);
  });

  it("writes a request when another window holds the folder", async () => {
    const broker = makeBroker();

    await broker.requestSleep(session());

    const body: unknown = JSON.parse(await readFile(join(dirs.requests, 'sleep-s1.json'), 'utf8'));
    expect(body).toMatchObject({ sessionId: 's1', cwd: '/Users/dev/projet', origin: 'vscode' });
    expect(closeCalls.sleepHere).toEqual([]);
  });

  it("removes NOTHING when nobody consumes — unlike closing, there is no tab to close", async () => {
    vi.useFakeTimers();
    try {
      const broker = makeBroker();
      await broker.requestSleep(session());

      await vi.advanceTimersByTimeAsync(2_000);
      await vi.waitFor(async () => expect(await readdir(dirs.requests)).toEqual([]));
      // A close's fallback removes the row; a sleep's fallback touches
      // nothing: with no window, there is no tab, so nothing to sleep.
      expect(closeCalls.forget).toEqual([]);
      expect(closeCalls.sleepHere).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('consumes a sleep request written for a folder it holds', async () => {
    const other = makeBroker();
    await other.requestSleep(session({ id: 's-cross' }));

    setWorkspaceFolders([{ uri: { fsPath: '/Users/dev/projet' } }]);
    const broker = makeBroker();
    const internal = broker as unknown as { consume: () => Promise<void> };
    await internal.consume();

    expect(closeCalls.sleepHere).toEqual(['s-cross']);
    expect(await readdir(dirs.requests)).toEqual([]);
  });

  it("discards a sleep request with no editor origin, and puts nothing to sleep", async () => {
    await writeFile(
      join(dirs.requests, 'sleep-s-term.json'),
      JSON.stringify({ sessionId: 's-term', cwd: '/Users/dev/projet', label: 'projet', origin: 'terminal', at: Date.now() }),
      'utf8',
    );

    setWorkspaceFolders([{ uri: { fsPath: '/Users/dev/projet' } }]);
    const broker = makeBroker();
    const internal = broker as unknown as { consume: () => Promise<void> };
    await internal.consume();

    expect(closeCalls.sleepHere).toEqual([]);
    expect(await readdir(dirs.requests)).toEqual([]);
  });
});

// The signal that feeds the memory of tabs opened here (claude/opened-here).
// This is the only instant where this window knows which conversation the
// tab about to appear belongs to: if the signal is missing, row selection
// falls back to the editor's memento, which lags by several tens of
// seconds. Nothing was checking it.
describe('FocusBroker — announces the conversation whose tab it just requested', () => {
  it('announces after a local reveal, with the id as argument', async () => {
    setWorkspaceFolders([{ uri: { fsPath: '/Users/dev/projet' } }]);
    const broker = makeBroker();

    await broker.request(session());

    expect(opened).toEqual(['s1']);
  });

  it('announces for a reopen too, which opens a tab just as much', async () => {
    setWorkspaceFolders([{ uri: { fsPath: '/Users/dev/projet' } }]);
    listed = true;
    const broker = makeBroker();

    await broker.requestReopen({ id: 's1', cwd: '/Users/dev/projet', project: 'projet', origin: 'vscode', closedAt: 0 });

    expect(opened).toEqual(['s1']);
  });

  it("announces nothing when no command was executed — a terminal opens no tab", async () => {
    setWorkspaceFolders([{ uri: { fsPath: '/Users/dev/projet' } }]);
    const broker = makeBroker();

    await broker.request(session({ origin: 'terminal' }));

    expect(opened).toEqual([]);
  });

  it("announces nothing when no window holds the folder: the request goes out, no tab opens here", async () => {
    const broker = makeBroker();

    await broker.request(session());

    expect(opened).toEqual([]);
  });
});
