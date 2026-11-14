/**
 * The whole start-up, end to end: `activate()` against a real state directory,
 * a sidebar that says it is ready, a file changing under it, the cockpit
 * opening. Only `vscode` is faked (test/stubs/vscode.ts).
 */
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type * as vscode from 'vscode';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { activate, cloudDeps, COCKPIT_PANEL, processDeps, SIDEBAR_VIEW, transcriptsRoot } from '../src/host/extension';
import type { ProcessDeps } from '../src/host/processes';
import { MENU_ITEMS } from '../src/host/menus';
import { readGroups } from '../../src/groups/store';
import { tableOf } from '../../src/process/scan';
import type { HostMessage } from '../src/shared/protocol';
import { ExtensionMode, FakeWebviewView, recorded, Uri } from './stubs/vscode';
import { fingerprint, makeHome, session } from './home';

let home: string;
let subscriptions: { dispose(): unknown }[];
const globalState = new Map<string, unknown>();
const savedHome = process.env['KOH_VIBE_HOME'];

function start(mode: ExtensionMode): void {
  subscriptions = [];
  const context = {
    extensionMode: mode,
    extensionUri: Uri.file('/ext'),
    extension: { packageJSON: { version: '0.0.1' } },
    subscriptions,
    globalState: {
      get: (k: string): unknown => globalState.get(k),
      update: (k: string, v: unknown): Promise<void> => {
        globalState.set(k, v);
        return Promise.resolve();
      },
    },
  };
  activate(context as unknown as vscode.ExtensionContext);
}

function messages(view: FakeWebviewView): HostMessage[] {
  return view.webview.posted as HostMessage[];
}

function sidebar(): FakeWebviewView {
  const provider = recorded.providers.get(SIDEBAR_VIEW);
  if (provider === undefined) throw new Error('sidebar provider not registered');
  const view = new FakeWebviewView();
  provider.resolveWebviewView(view);
  return view;
}

/** Never the machine's own `ps`: a fixed table, and a count of the `lsof` calls. */
const fakeProcs = { orphanScans: 0, roots: [] as readonly string[] };
const deps: ProcessDeps = {
  table: async () => tableOf([{ pid: 100, ppid: 1, elapsed: 60, rss: 2048, command: 'claude' }, { pid: 101, ppid: 100, elapsed: 50, rss: 4096, command: 'node mcp.js' }]),
  live: async () => new Map([['a', { pid: 100, sessionId: 'a', cwd: '/work/a', entrypoint: 'cli' }]]),
  orphans: async (_table, roots) => {
    fakeProcs.orphanScans++;
    fakeProcs.roots = roots;
    return [];
  },
};

beforeEach(async () => {
  recorded.reset();
  globalState.clear();
  fakeProcs.orphanScans = 0;
  processDeps.current = deps;
  home = await makeHome();
  // Never the machine's own transcripts: an empty projects directory inside the fake home.
  transcriptsRoot.current = join(home, 'no-transcripts');
  // Signed out, and a network that throws: no test reads the keychain or reaches claude.ai.
  cloudDeps.current = { credentials: async () => undefined, send: () => Promise.reject(new Error('no network in tests')) };
  process.env['KOH_VIBE_HOME'] = home;
});

afterEach(async () => {
  for (const s of subscriptions) s.dispose();
  processDeps.current = undefined;
  transcriptsRoot.current = undefined;
  cloudDeps.current = undefined;
  if (savedHome === undefined) delete process.env['KOH_VIBE_HOME'];
  else process.env['KOH_VIBE_HOME'] = savedHome;
  await rm(home, { recursive: true, force: true });
});

describe('activate', () => {
  it('registers the sidebar and the commands', () => {
    start(ExtensionMode.Production);
    expect([...recorded.providers.keys()]).toEqual([SIDEBAR_VIEW]);
    // Two of its own, and one per right-click entry (menus.ts).
    expect([...recorded.commands.keys()].sort()).toEqual(['kohVibeNext.openCockpit', 'kohVibeNext.reload', ...MENU_ITEMS.map((m) => m.command)].sort());
  });

  it('serves the built bundle outside a development host', () => {
    start(ExtensionMode.Production);
    const html = sidebar().webview.html;
    expect(html).toContain('dist/view/assets/main.js');
    expect(html).not.toContain('localhost');
  });

  it('serves the view from Vite in a development host', () => {
    start(ExtensionMode.Development);
    expect(sidebar().webview.html).toContain('http://localhost:5199/src/main.tsx');
  });

  it('sends the sidebar its context and the state on disk once it is ready', async () => {
    start(ExtensionMode.Production);
    const view = sidebar();
    expect(messages(view)).toEqual([]);
    await view.webview.receive({ type: 'ready' });
    const first = messages(view)[0];
    expect(first?.type).toBe('init');
    if (first?.type !== 'init') return;
    expect(first.context).toMatchObject({ surface: 'sidebar', language: 'fr', version: '0.0.1' });
    expect(first.context.launch).toMatch(/^[0-9a-f-]{36}$/);
    expect(first.snapshot.sessions).toHaveLength(4);
  });

  it('follows a change on disk without writing anything itself', async () => {
    start(ExtensionMode.Production);
    const view = sidebar();
    await view.webview.receive({ type: 'ready' });
    await writeFile(join(home, 'sessions', 'f.json'), JSON.stringify(session('f', { status: 'waiting' })));
    const afterOurWrite = await fingerprint(home);
    await vi.waitFor(
      () => {
        const last = messages(view).at(-1);
        expect(last?.type === 'snapshot' && last.snapshot.sessions.some((s) => s.id === 'f')).toBe(true);
      },
      // fs.watch usually answers within milliseconds, but macOS may drop an
      // event under load; the 5 s poll (watch.ts) then catches it. Waiting
      // past the poll keeps the test about following the disk, not about
      // which of the two paths did.
      { timeout: 7_000, interval: 50 },
    );
    expect(await fingerprint(home)).toBe(afterOurWrite);
  }, 10_000);

  it('opens one cockpit, inits it as the cockpit, and reveals it on the next ask', async () => {
    start(ExtensionMode.Production);
    const view = sidebar();
    await view.webview.receive({ type: 'ready' });
    await view.webview.receive({ type: 'openCockpit', sessionId: 'a' });
    expect(recorded.panels).toHaveLength(1);
    const panel = recorded.panels[0];
    if (panel === undefined) return;
    expect(panel.viewType).toBe(COCKPIT_PANEL);
    await panel.webview.receive({ type: 'ready' });
    const init = (panel.webview.posted as HostMessage[])[0];
    expect(init?.type === 'init' && init.context.surface).toBe('cockpit');
    await view.webview.receive({ type: 'openCockpit' });
    expect(recorded.panels).toHaveLength(1);
    expect(panel.revealed).toBe(1);
    panel.dispose();
    await view.webview.receive({ type: 'openCockpit' });
    expect(recorded.panels).toHaveLength(2);
  });

  it('ignores malformed messages from the page', async () => {
    start(ExtensionMode.Production);
    const view = sidebar();
    await view.webview.receive({ type: 'openCockpit', sessionId: 42 });
    await view.webview.receive('ready');
    expect(recorded.panels).toHaveLength(0);
    expect(messages(view)).toEqual([]);
  });

  it('replaces, rather than stacks, a view that says ready twice', async () => {
    start(ExtensionMode.Production);
    const view = sidebar();
    await view.webview.receive({ type: 'ready' });
    await view.webview.receive({ type: 'ready' });
    const reload = recorded.commands.get('kohVibeNext.reload');
    await view.webview.receive({ type: 'reload' });
    expect(reload).toBeDefined();
    const all = messages(view);
    const types = all.map((m) => m.type);
    expect(types.filter((t) => t === 'init')).toHaveLength(2);
    // Stacked clients would each post every build: the same snapshot twice.
    // (How many builds there are varies — the names warm up in the background.)
    const after = all.slice(types.lastIndexOf('init') + 1);
    expect(after.length).toBeGreaterThan(0);
    // Each client gets its own envelope around the SAME snapshot: compare those.
    const sent = after.map((m) => (m.type === 'snapshot' ? m.snapshot : m));
    expect(new Set(sent).size).toBe(sent.length);
  });

  it('shows what each conversation runs, and looks for orphans only behind the Processes tab', async () => {
    start(ExtensionMode.Production);
    const view = sidebar();
    await view.webview.receive({ type: 'ready' });
    const init = messages(view)[0];
    expect(init?.type === 'init' && init.snapshot.processes?.bySession['a']?.map((p) => p.label)).toEqual(['node mcp.js']);
    expect(init?.type === 'init' && init.snapshot.processes?.orphans).toBeUndefined();
    expect(fakeProcs.orphanScans).toBe(0);
    await view.webview.receive({ type: 'tab', tab: 'processes' });
    await vi.waitFor(() => expect(fakeProcs.orphanScans).toBeGreaterThan(0), { timeout: 2_000, interval: 20 });
    expect(fakeProcs.roots).toContain('/work/open-folder');
    expect(fakeProcs.roots).toContain('/work/a');
    const scans = fakeProcs.orphanScans;
    await view.webview.receive({ type: 'tab', tab: 'sessions' });
    await view.webview.receive({ type: 'reload' });
    expect(fakeProcs.orphanScans).toBe(scans);
  });

  it('opens an artifact on claude.ai, and nothing for a slug that is not one', async () => {
    start(ExtensionMode.Production);
    const view = sidebar();
    await view.webview.receive({ type: 'openArtifact', slug: 'abc-123' });
    await view.webview.receive({ type: 'openArtifact', slug: '../evil' });
    expect(recorded.opened).toEqual(['https://claude.ai/artifact/abc-123']);
  });

  it('counts open conversations in the status bar', async () => {
    start(ExtensionMode.Production);
    const view = sidebar();
    await view.webview.receive({ type: 'ready' });
    const item = recorded.statusItems[0];
    expect(item?.visible).toBe(true);
    // a running, b waiting, c idle; e is ended and does not count.
    expect(item?.text).toBe('$(question) 1 · $(circle-filled) 1');
    expect(item?.command).toBe(`${SIDEBAR_VIEW}.focus`);
  });

  it('hands a click on a conversation to V1, which owns what the click writes', async () => {
    start(ExtensionMode.Production);
    const got: unknown[] = [];
    recorded.commands.set('kohVibe.focusSession', (s: unknown) => got.push(s));
    const view = sidebar();
    const before = await fingerprint(home);
    await view.webview.receive({ type: 'openSession', sessionId: 'b' });
    await vi.waitFor(() => expect(got).toHaveLength(1), { timeout: 1_000, interval: 10 });
    expect(got[0]).toMatchObject({ id: 'b', cwd: '/work/b', status: 'waiting' });
    expect(recorded.panels).toHaveLength(0);
    expect(await fingerprint(home)).toBe(before);
  });

  it('opens the cockpit instead when V1 is not there', async () => {
    start(ExtensionMode.Production);
    const view = sidebar();
    await view.webview.receive({ type: 'openSession', sessionId: 'b' });
    await vi.waitFor(() => expect(recorded.panels).toHaveLength(1), { timeout: 1_000, interval: 10 });
  });

  it('hands a closed conversation to V1 to resume, and tells the view', async () => {
    start(ExtensionMode.Production);
    const got: unknown[] = [];
    recorded.commands.set('kohVibe.reopenSession', (e: unknown) => got.push(e));
    const view = sidebar();
    const id = '11111111-1111-4111-8111-111111111111';
    const before = await fingerprint(home);
    await view.webview.receive({ type: 'reopenClosed', sessionId: id });
    await vi.waitFor(() => expect(messages(view).some((m) => m.type === 'reopen')).toBe(true), { timeout: 1_000, interval: 10 });
    expect(got[0]).toMatchObject({ id, cwd: '/w', origin: 'vscode' });
    expect(messages(view).find((m) => m.type === 'reopen')).toEqual({ type: 'reopen', sessionId: id, outcome: 'v1' });
    expect(await fingerprint(home)).toBe(before);
  });

  it('says so when V1 is not there to resume it', async () => {
    start(ExtensionMode.Production);
    const view = sidebar();
    await view.webview.receive({ type: 'reopenClosed', sessionId: '11111111-1111-4111-8111-111111111111' });
    await vi.waitFor(() => expect(messages(view).find((m) => m.type === 'reopen')).toMatchObject({ outcome: 'unavailable' }), { timeout: 1_000, interval: 10 });
  });

  it('writes a folder through V1 stores and answers the view', async () => {
    start(ExtensionMode.Production);
    const view = sidebar();
    await view.webview.receive({ type: 'act', req: 7, action: { kind: 'folder.rename', id: 'g1', name: 'Renamed' } });
    await vi.waitFor(() => expect(messages(view).find((m) => m.type === 'acted')).toEqual({ type: 'acted', req: 7, result: { ok: true } }), { timeout: 1_000, interval: 10 });
    expect((await readGroups(join(home, 'groups.json'))).groups.find((g) => g.id === 'g1')?.name).toBe('Renamed');
  });

  it('drops a malformed action without answering or writing', async () => {
    start(ExtensionMode.Production);
    const view = sidebar();
    const before = await fingerprint(home);
    await view.webview.receive({ type: 'act', req: 1, action: { kind: 'folder.rename', id: 'g1', name: '' } });
    expect(messages(view).some((m) => m.type === 'acted')).toBe(false);
    expect(await fingerprint(home)).toBe(before);
  });

  it('copies a conversation id to the clipboard', async () => {
    start(ExtensionMode.Production);
    const view = sidebar();
    await view.webview.receive({ type: 'act', req: 2, action: { kind: 'session.copyId', id: 'b' } });
    await vi.waitFor(() => expect(recorded.clipboard).toEqual(['b']), { timeout: 1_000, interval: 10 });
  });

  it('asks claude.ai for nothing when signed out, and says so on a cloud action', async () => {
    start(ExtensionMode.Production);
    const view = sidebar();
    await view.webview.receive({ type: 'tab', tab: 'artifacts' });
    await view.webview.receive({ type: 'act', req: 3, action: { kind: 'artifact.pin', slug: 'x', pinned: false } });
    await vi.waitFor(() => expect(messages(view).find((m) => m.type === 'acted')).toEqual({ type: 'acted', req: 3, result: { ok: false, error: 'cloud' } }), { timeout: 1_000, interval: 10 });
  });

  it('runs a right-click entry on the row it was opened on', async () => {
    start(ExtensionMode.Production);
    const got: unknown[] = [];
    recorded.commands.set('kohVibe.sleepSession', (n: unknown) => got.push(n));
    await recorded.commands.get('kohVibeNext.ctx.session.sleep')?.({ webviewSection: 'kvnSession', kvnSessionId: 'b', webview: 'kohVibeNext.sidebar' });
    expect(got).toEqual([{ kind: 'session', session: { id: 'b' } }]);
  });

  it('shows the editor tab bar and writes it where the editor reads it', async () => {
    recorded.config.set('workbench.editor.showTabs', 'single');
    start(ExtensionMode.Production);
    const view = sidebar();
    await view.webview.receive({ type: 'ready' });
    const init = messages(view)[0];
    expect(init?.type === 'init' && init.snapshot.editorTabs).toBe('single');
    await view.webview.receive({ type: 'act', req: 4, action: { kind: 'setting.editorTabs', mode: 'none' } });
    await vi.waitFor(() => expect(recorded.config.get('workbench.editor.showTabs')).toBe('none'), { timeout: 1_000, interval: 10 });
  });

  it('starts the views again in the language picked', async () => {
    start(ExtensionMode.Production);
    const view = sidebar();
    await view.webview.receive({ type: 'ready' });
    const first = messages(view)[0];
    expect(first?.type === 'init' && first.context.languageChoice).toBe('auto');
    view.webview.html = '';
    await view.webview.receive({ type: 'act', req: 5, action: { kind: 'setting.language', choice: 'en' } });
    // Reloaded: the page is served again (with a fresh nonce, so not byte for byte).
    await vi.waitFor(() => expect(view.webview.html).toContain('<!doctype html>'), { timeout: 1_000, interval: 10 });
    await view.webview.receive({ type: 'ready' });
    const again = messages(view).filter((m) => m.type === 'init').at(-1);
    expect(again?.type === 'init' && [again.context.language, again.context.languageChoice]).toEqual(['en', 'en']);
  });

  it('reads the transcripts only while a cockpit is open', async () => {
    start(ExtensionMode.Production);
    const view = sidebar();
    await view.webview.receive({ type: 'ready' });
    const init = messages(view)[0];
    expect(init?.type === 'init' && init.snapshot.activity).toBeUndefined();
    await view.webview.receive({ type: 'openCockpit' });
    await vi.waitFor(
      () => {
        const last = messages(view).at(-1);
        expect(last?.type === 'snapshot' && last.snapshot.activity?.sessions).toEqual([]);
      },
      { timeout: 2_000, interval: 20 },
    );
  });

  it('opens the cockpit on a conversation\'s sheet, once the cockpit can hear it', async () => {
    start(ExtensionMode.Production);
    const view = sidebar();
    await view.webview.receive({ type: 'openCockpit', sessionId: 'b' });
    const panel = recorded.panels[0];
    if (panel === undefined) throw new Error('no cockpit');
    await panel.webview.receive({ type: 'ready' });
    expect(panel.webview.posted).toContainEqual({ type: 'showSheet', sessionId: 'b' });
    // Already open: told at once.
    await view.webview.receive({ type: 'openCockpit', sessionId: 'a' });
    expect(panel.webview.posted).toContainEqual({ type: 'showSheet', sessionId: 'a' });
  });

  it('builds the sheet of the conversation the cockpit shows, from its transcript', async () => {
    const dir = join(home, 'no-transcripts', 'proj');
    await mkdir(join(dir, 'b', 'subagents'), { recursive: true });
    const at = new Date().toISOString();
    const line = (o: unknown) => `${JSON.stringify(o)}\n`;
    await writeFile(
      join(dir, 'b.jsonl'),
      line({ type: 'user', timestamp: at, cwd: '/work/b', message: { content: 'Fix it' } }) +
        line({ type: 'assistant', timestamp: at, message: { id: 'm1', usage: { input_tokens: 5, output_tokens: 1 }, content: [{ type: 'tool_use', name: 'Edit', input: { file_path: '/work/b/src/x.ts' } }] } }),
    );
    await writeFile(join(dir, 'b', 'subagents', 'agent-q1.jsonl'), line({ type: 'user', timestamp: at, message: { content: 'Look around' } }));
    await writeFile(join(dir, 'b', 'subagents', 'agent-q1.meta.json'), JSON.stringify({ description: 'Survey', agentType: 'Explore' }));
    start(ExtensionMode.Production);
    const view = sidebar();
    await view.webview.receive({ type: 'openCockpit' });
    const panel = recorded.panels[0];
    if (panel === undefined) throw new Error('no cockpit');
    await panel.webview.receive({ type: 'ready' });
    await panel.webview.receive({ type: 'sheet', sessionId: 'b' });
    await vi.waitFor(
      () => {
        const last = (panel.webview.posted as HostMessage[]).filter((m) => m.type === 'snapshot').at(-1);
        const sheet = last?.type === 'snapshot' ? last.snapshot.sheet : undefined;
        expect(sheet?.files).toEqual([{ path: 'src/x.ts', writes: 1, lastAt: Date.parse(at) }]);
        expect(sheet?.agents.map((a) => [a.label, a.type])).toEqual([['Survey', 'Explore']]);
        expect(sheet?.lastPrompt?.text).toBe('Fix it');
      },
      { timeout: 3_000, interval: 30 },
    );
  });
});
