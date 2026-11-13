import * as vscode from 'vscode';
import { claudeHome, claudeSessionsDir, kohVibeHome } from '../../../src/paths';
import { parseViewMessage, type SidebarTab, type Surface, type ViewContext } from '../shared/protocol';
import { Hub } from './hub';
import { COCKPIT_PANEL, SIDEBAR_VIEW } from './ids';
import { scanProcesses, systemProcessDeps, type ProcessDeps } from './processes';
import { buildSnapshot } from './snapshot';
import { createStatusBar } from './status-bar';
import { watchHome, type Disposable } from './watch';
import { builtHtml, devHtml, makeNonce } from './webview-html';

export { COCKPIT_PANEL, SIDEBAR_VIEW };
export const DEFAULT_DEV_URL = 'http://localhost:5199';

/**
 * Where the view's code comes from. Only a development host (F5) uses Vite:
 * an installed build must never depend on a local server being up.
 */
export function viewSource(context: vscode.ExtensionContext, env: NodeJS.ProcessEnv = process.env): 'dev' | 'built' {
  if (context.extensionMode !== vscode.ExtensionMode.Development) return 'built';
  return env['KOH_VIBE_NEXT_BUILT'] === '1' ? 'built' : 'dev';
}

function devUrl(env: NodeJS.ProcessEnv = process.env): string {
  const v = env['KOH_VIBE_NEXT_DEV_URL'];
  return v !== undefined && v.length > 0 ? v.replace(/\/$/, '') : DEFAULT_DEV_URL;
}

/** `packageJSON` is typed `any` by VSCode: read it as `unknown`. */
export function versionOf(pkg: unknown): string {
  if (typeof pkg !== 'object' || pkg === null) return '';
  const v = (pkg as Record<string, unknown>)['version'];
  return typeof v === 'string' ? v : '';
}

function viewRoot(context: vscode.ExtensionContext): vscode.Uri {
  return vscode.Uri.joinPath(context.extensionUri, 'dist', 'view');
}

function renderHtml(webview: vscode.Webview, context: vscode.ExtensionContext): string {
  const base = { cspSource: webview.cspSource, nonce: makeNonce() };
  if (viewSource(context) === 'dev') return devHtml({ ...base, kind: 'dev', devUrl: devUrl() });
  const assets = vscode.Uri.joinPath(viewRoot(context), 'assets');
  return builtHtml({
    ...base,
    kind: 'built',
    scriptUri: webview.asWebviewUri(vscode.Uri.joinPath(assets, 'main.js')).toString(),
    styleUri: webview.asWebviewUri(vscode.Uri.joinPath(assets, 'main.css')).toString(),
  });
}

function webviewOptions(context: vscode.ExtensionContext): vscode.WebviewOptions {
  return { enableScripts: true, localResourceRoots: [viewRoot(context)] };
}

/**
 * Wires one web view to the hub: HTML, then a client once the page says it
 * is ready — never before, since a message posted to a page that has not
 * loaded its script yet is lost.
 */
function connect(
  webview: vscode.Webview,
  surface: Surface,
  context: vscode.ExtensionContext,
  hub: Hub,
  actions: { openCockpit(sessionId?: string): void; showTab(tab: SidebarTab | undefined): void },
): Disposable {
  webview.options = webviewOptions(context);
  webview.html = renderHtml(webview, context);
  const viewContext = (): ViewContext => ({
    surface,
    language: vscode.env.language,
    version: versionOf(context.extension.packageJSON as unknown),
  });
  let client: Disposable | undefined;
  const sub = webview.onDidReceiveMessage(async (raw: unknown) => {
    const msg = parseViewMessage(raw);
    if (msg === undefined) return;
    switch (msg.type) {
      case 'ready':
        // A reload of the page (Vite full reload, "Reload the view") says
        // ready again: replace its client rather than stacking a second.
        client?.dispose();
        client = await hub.attach({ context: viewContext(), post: (m) => void webview.postMessage(m) });
        return;
      case 'reload':
        await hub.refresh();
        return;
      case 'openCockpit':
        actions.openCockpit(msg.sessionId);
        return;
      case 'tab':
        actions.showTab(msg.tab);
        return;
      case 'openArtifact':
        void vscode.env.openExternal(vscode.Uri.parse(`https://claude.ai/artifact/${msg.slug}`));
        return;
    }
  });
  return {
    dispose(): void {
      actions.showTab(undefined);
      client?.dispose();
      sub.dispose();
    },
  };
}

/** Overridable by tests, which must not read the machine's process table. */
export const processDeps: { current: ProcessDeps | undefined } = { current: undefined };

export function activate(context: vscode.ExtensionContext): void {
  const home = kohVibeHome();
  const output = vscode.window.createOutputChannel('Koh-Vibe Next');
  const procs = processDeps.current ?? systemProcessDeps(claudeSessionsDir(claudeHome()));
  // The tab each open view shows. Orphans cost an `lsof` over every adopted
  // dev server: looked for only while some view has the Processes tab open.
  const tabs = new Map<object, SidebarTab>();
  const wantOrphans = (): boolean => [...tabs.values()].includes('processes');
  const workspaceRoots = (): string[] => (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath);
  const hub = new Hub({
    build: () =>
      buildSnapshot(home, Date.now(), {
        processes: (cwds) => scanProcesses(procs, [...workspaceRoots(), ...cwds], wantOrphans(), Date.now()),
      }),
    watch: (onChange) => watchHome(home, onChange),
    log: (m) => output.appendLine(m),
  });
  const statusBar = createStatusBar();
  context.subscriptions.push(output, hub, statusBar, hub.subscribe((snap) => statusBar.update(snap)));

  /** One tab tracker per view; a switch to Processes rebuilds at once rather than at the next poll. */
  const tabTracker = (): { openCockpit(): void; showTab(tab: SidebarTab | undefined): void } => {
    const key = {};
    return {
      openCockpit: () => openCockpit(),
      showTab(tab) {
        const before = wantOrphans();
        if (tab === undefined) tabs.delete(key);
        else tabs.set(key, tab);
        if (wantOrphans() && !before) void hub.refresh();
      },
    };
  };

  const views: { webview: vscode.Webview; reload(): void }[] = [];
  let cockpit: vscode.WebviewPanel | undefined;

  function openCockpit(): void {
    if (cockpit !== undefined) {
      cockpit.reveal();
      return;
    }
    const panel = vscode.window.createWebviewPanel(COCKPIT_PANEL, 'Koh-Vibe', vscode.ViewColumn.Active, {
      ...webviewOptions(context),
      retainContextWhenHidden: true,
    });
    panel.iconPath = vscode.Uri.joinPath(context.extensionUri, 'resources', 'logo-mono.svg');
    const link = connect(panel.webview, 'cockpit', context, hub, tabTracker());
    const entry = { webview: panel.webview, reload: () => (panel.webview.html = renderHtml(panel.webview, context)) };
    views.push(entry);
    cockpit = panel;
    panel.onDidDispose(() => {
      link.dispose();
      views.splice(views.indexOf(entry), 1);
      cockpit = undefined;
    });
  }

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(SIDEBAR_VIEW, {
      resolveWebviewView(view: vscode.WebviewView): void {
        const link = connect(view.webview, 'sidebar', context, hub, tabTracker());
        const entry = { webview: view.webview, reload: () => (view.webview.html = renderHtml(view.webview, context)) };
        views.push(entry);
        view.onDidDispose(() => {
          link.dispose();
          views.splice(views.indexOf(entry), 1);
        });
      },
    }),
    vscode.commands.registerCommand('kohVibeNext.openCockpit', openCockpit),
    vscode.commands.registerCommand('kohVibeNext.reload', () => {
      for (const v of views) v.reload();
    }),
  );
}

export function deactivate(): void {
  // Everything hangs off context.subscriptions.
}
