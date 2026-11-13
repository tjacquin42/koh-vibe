/**
 * The whole start-up, end to end: `activate()` against a real state directory,
 * a sidebar that says it is ready, a file changing under it, the cockpit
 * opening. Only `vscode` is faked (test/stubs/vscode.ts).
 */
import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type * as vscode from 'vscode';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { activate, COCKPIT_PANEL, SIDEBAR_VIEW } from '../src/host/extension';
import type { HostMessage } from '../src/shared/protocol';
import { ExtensionMode, FakeWebviewView, recorded, Uri } from './stubs/vscode';
import { fingerprint, makeHome, session } from './home';

let home: string;
let subscriptions: { dispose(): unknown }[];
const savedHome = process.env['KOH_VIBE_HOME'];

function start(mode: ExtensionMode): void {
  subscriptions = [];
  const context = {
    extensionMode: mode,
    extensionUri: Uri.file('/ext'),
    extension: { packageJSON: { version: '0.0.1' } },
    subscriptions,
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

beforeEach(async () => {
  recorded.reset();
  home = await makeHome();
  process.env['KOH_VIBE_HOME'] = home;
});

afterEach(async () => {
  for (const s of subscriptions) s.dispose();
  if (savedHome === undefined) delete process.env['KOH_VIBE_HOME'];
  else process.env['KOH_VIBE_HOME'] = savedHome;
  await rm(home, { recursive: true, force: true });
});

describe('activate', () => {
  it('registers the sidebar and the commands', () => {
    start(ExtensionMode.Production);
    expect([...recorded.providers.keys()]).toEqual([SIDEBAR_VIEW]);
    expect([...recorded.commands.keys()].sort()).toEqual(['kohVibeNext.openCockpit', 'kohVibeNext.reload']);
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
    expect(first.context).toEqual({ surface: 'sidebar', language: 'fr', version: '0.0.1' });
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
      { timeout: 3_000, interval: 50 },
    );
    expect(await fingerprint(home)).toBe(afterOurWrite);
  });

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
    expect(messages(view).map((m) => m.type)).toEqual(['init', 'init', 'snapshot']);
  });
});
