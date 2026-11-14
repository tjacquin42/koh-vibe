import * as vscode from 'vscode';
import { readClosed } from '../../../src/closed/store';
import { artifactProjectsFile, claudeHome, claudeSessionsDir, closedFile, groupsFile, kohVibeHome, settingsFile, spoolDirs } from '../../../src/paths';
import { readSessions } from '../../../src/spool/persist';
import { parseViewMessage, type HostMessage, type ReopenOutcome, type SidebarTab, type Surface, type ViewContext } from '../shared/protocol';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { Action, ActionResult } from '../shared/actions';
import { runAction, type Copied } from './actions';
import { cloudActions } from './cloud';
import type { TranscriptStats } from '../../../src/transcript/reader';
import { readCredentials, type CloudDeps } from '../../../src/cloud/account';
import { logged } from '../../../src/cloud/log';
import { send } from '../../../src/cloud/request';
import { killAll } from '../../../src/process/kill';
import { ActivityIndex, WINDOW_MS } from './activity/index';
import { toActivityView } from './activity/view';
import { buildSheet, readAgentMetas } from './activity/sheet';
import { homedir } from 'node:os';
import { Hub } from './hub';
import { COCKPIT_PANEL, SIDEBAR_VIEW } from './ids';
import { openSession, reopenClosed } from './open-session';
import { locateProcess, scanProcesses, systemProcessDeps, type ProcessDeps } from './processes';
import { buildSnapshot, namesFrom } from './snapshot';
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

/** The status bar line after a copy — V1's wording, so its translations apply. */
function copiedMessage(what: Copied, text: string): string {
  switch (what) {
    case 'id':
      return vscode.l10n.t('Koh-Vibe: conversation ID copied');
    case 'link':
      return vscode.l10n.t('Koh-Vibe: link copied');
    case 'pid':
      return vscode.l10n.t('Koh-Vibe: pid {0} copied', text);
    case 'command':
      return vscode.l10n.t('Koh-Vibe: command copied');
  }
}

/** What a view's messages can ask of the extension, beyond the hub. */
interface ViewActions {
  openCockpit(sessionId?: string): void;
  openSession(sessionId: string): void;
  reopenClosed(sessionId: string): Promise<ReopenOutcome>;
  /** The cockpit's sheet: which conversation it shows, `null` for none. */
  sheet(sessionId: string | null): void;
  /** Once the view has its first message: the cockpit is told which sheet to open, if one waits. */
  ready(post: (m: HostMessage) => void): void;
  act(action: Action): Promise<ActionResult>;
  showTab(tab: SidebarTab | undefined): void;
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
  actions: ViewActions,
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
        actions.ready((m) => void webview.postMessage(m));
        return;
      case 'sheet':
        actions.sheet(msg.sessionId);
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
      case 'openSession':
        actions.openSession(msg.sessionId);
        return;
      case 'reopenClosed': {
        // Told back to this view only: the spinner is on its row.
        const reply: HostMessage = { type: 'reopen', sessionId: msg.sessionId, outcome: await actions.reopenClosed(msg.sessionId) };
        void webview.postMessage(reply);
        return;
      }
      case 'act': {
        const reply: HostMessage = { type: 'acted', req: msg.req, result: await actions.act(msg.action) };
        void webview.postMessage(reply);
        return;
      }
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
/** Overridable by tests, which must neither read the keychain nor call claude.ai. */
export const cloudDeps: { current: CloudDeps | undefined } = { current: undefined };
/** Overridable by tests, which must not read the machine's transcripts. */
export const transcriptsRoot: { current: string | undefined } = { current: undefined };

export function activate(context: vscode.ExtensionContext): void {
  const home = kohVibeHome();
  const output = vscode.window.createOutputChannel('Koh-Vibe Next');
  const procs = processDeps.current ?? systemProcessDeps(claudeSessionsDir(claudeHome()));
  // claude.ai, as V1 calls it: a failed call is written to the output channel
  // (V1's cloud/log.ts) — never the token, never the body.
  const cloud = cloudActions(home, cloudDeps.current ?? { send: logged(send, (line) => output.appendLine(line)), credentials: () => readCredentials() });
  // The tab each open view shows. Orphans cost an `lsof` over every adopted
  // dev server: looked for only while some view has the Processes tab open.
  const tabs = new Map<object, SidebarTab>();
  const wantOrphans = (): boolean => [...tabs.values()].includes('processes');
  const workspaceRoots = (): string[] => (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath);
  // Transcripts are read only while a cockpit is open to show them, and the
  // index is dropped with the last cockpit: reopened, it reads its window again.
  let activity: ActivityIndex | undefined;
  const transcripts = transcriptsRoot.current ?? join(claudeHome(), 'projects');
  // V1's incremental transcript readings: how a conversation gets its name.
  // The first pass reads every transcript whole (2.4 s on a busy machine);
  // it runs apart, so the list shows at once and the names follow.
  const namesFromTranscripts = new Map<string, TranscriptStats>();
  let names: 'cold' | 'warming' | 'ready' = 'cold';
  const warmNames = async (): Promise<void> => {
    names = 'warming';
    try {
      await namesFrom(await readSessions(spoolDirs(home)), namesFromTranscripts);
    } finally {
      names = 'ready';
      void hub.refresh();
    }
  };
  const hub = new Hub({
    build: () => {
      // The shared lists, asked again only while a view shows them and at
      // most every five minutes (Feed): a write lands in the cache file,
      // which the watcher turns into the next build.
      for (const what of ['artifacts', 'routines'] as const) {
        if ([...tabs.values()].includes(what)) void cloud.refresh(what, false);
      }
      if (names === 'cold') void warmNames();
      return buildSnapshot(home, Date.now(), {
        ...(names === 'ready' ? { transcripts: namesFromTranscripts } : {}),
        processes: (cwds) => scanProcesses(procs, [...workspaceRoots(), ...cwds], wantOrphans(), Date.now()),
        activity: async (known) => {
          if (cockpit === undefined) {
            activity = undefined;
            return undefined;
          }
          activity ??= new ActivityIndex(transcripts);
          const now = Date.now();
          await activity.refresh(now);
          return toActivityView(activity.states, now, now - WINDOW_MS, known);
        },
        sheet: async () => {
          if (cockpit === undefined || activity === undefined || sheetFor === undefined) return undefined;
          const id = sheetFor;
          const states = activity.states.filter((s) => s.sessionId === id);
          const now = Date.now();
          return buildSheet(states, id, now - WINDOW_MS, await readAgentMetas(states), homedir());
        },
      });
    },
    watch: (onChange) => watchHome(home, onChange),
    log: (m) => output.appendLine(m),
  });
  const statusBar = createStatusBar();
  context.subscriptions.push(output, hub, statusBar, hub.subscribe((snap) => statusBar.update(snap)));

  /** One tab tracker per view; a switch to Processes rebuilds at once rather than at the next poll. */
  const focus = (sessionId: string): void => {
    void openSession(sessionId, {
      read: async (id) => (await readSessions(spoolDirs(home))).get(id),
      hasCommand: async (cmd) => (await vscode.commands.getCommands(true)).includes(cmd),
      run: (cmd, arg) => vscode.commands.executeCommand(cmd, arg),
      fallback: (id) => openCockpit(id),
    });
  };

  const reopen = (sessionId: string): Promise<ReopenOutcome> =>
    reopenClosed(sessionId, {
      read: async (id) => (await readClosed(closedFile(home))).closed.find((e) => e.id === id),
      hasCommand: async (cmd) => (await vscode.commands.getCommands(true)).includes(cmd),
      run: (cmd, arg) => vscode.commands.executeCommand(cmd, arg),
    });

  // The first writes of the V2: shared files through V1's own stores, the
  // rest handed to V1's commands (actions.ts). The watcher sees the files
  // change and rebuilds; a refresh right away keeps the click from lagging.
  const act = async (action: Action): Promise<ActionResult> => {
    const result = await runAction(action, {
      groupsFile: groupsFile(home),
      settingsFile: settingsFile(home),
      newId: () => randomUUID(),
      hasCommand: async (cmd) => (await vscode.commands.getCommands(true)).includes(cmd),
      run: (cmd, ...args) => vscode.commands.executeCommand(cmd, ...args),
      artifactProjectsFile: artifactProjectsFile(home),
      copy: async (text, what) => {
        await vscode.env.clipboard.writeText(text);
        vscode.window.setStatusBarMessage(copiedMessage(what, text), 3000);
      },
      open: (url) => void vscode.env.openExternal(vscode.Uri.parse(url)),
      cloud,
      locate: (pid) => locateProcess(procs, workspaceRoots(), pid),
      confirmKill: async (plan) => {
        const confirm = vscode.l10n.t('Terminate');
        const answer = await vscode.window.showWarningMessage(plan.message, { modal: true, ...(plan.detail === undefined ? {} : { detail: plan.detail }) }, confirm);
        return answer === confirm;
      },
      kill: (targets) => killAll(targets),
    });
    void hub.refresh();
    return result;
  };

  // The conversation whose sheet the cockpit shows, and one asked for before
  // the cockpit was ready to hear it.
  let sheetFor: string | undefined;
  let pendingSheet: string | undefined;

  const tabTracker = (surface: Surface): ViewActions => {
    const key = {};
    return {
      act,
      openCockpit: (sessionId) => openCockpit(sessionId),
      sheet(sessionId) {
        sheetFor = sessionId ?? undefined;
        void hub.refresh();
      },
      ready(post) {
        if (surface !== 'cockpit' || pendingSheet === undefined) return;
        post({ type: 'showSheet', sessionId: pendingSheet });
        pendingSheet = undefined;
      },
      openSession: focus,
      reopenClosed: reopen,
      showTab(tab) {
        const before = wantOrphans();
        if (tab === undefined) tabs.delete(key);
        else tabs.set(key, tab);
        if (wantOrphans() && !before) void hub.refresh();
        // A cloud tab just shown: its list may be stale; refresh(false) asks
        // claude.ai only if the shared cache is older than five minutes.
        if (tab === 'artifacts' || tab === 'routines') void cloud.refresh(tab, false);
      },
    };
  };

  const views: { webview: vscode.Webview; reload(): void }[] = [];
  let cockpit: vscode.WebviewPanel | undefined;

  /** Opens the cockpit — on a conversation's sheet when `sessionId` says which. */
  function openCockpit(sessionId?: string): void {
    if (cockpit !== undefined) {
      cockpit.reveal();
      if (sessionId !== undefined) void cockpit.webview.postMessage({ type: 'showSheet', sessionId } satisfies HostMessage);
      return;
    }
    pendingSheet = sessionId;
    const panel = vscode.window.createWebviewPanel(COCKPIT_PANEL, 'Koh-Vibe', vscode.ViewColumn.Active, {
      ...webviewOptions(context),
      retainContextWhenHidden: true,
    });
    panel.iconPath = vscode.Uri.joinPath(context.extensionUri, 'resources', 'logo-mono.svg');
    const link = connect(panel.webview, 'cockpit', context, hub, tabTracker('cockpit'));
    const entry = { webview: panel.webview, reload: () => (panel.webview.html = renderHtml(panel.webview, context)) };
    views.push(entry);
    cockpit = panel;
    // The cockpit needs the activity the sidebar never asks for: build it now.
    void hub.refresh();
    panel.onDidDispose(() => {
      link.dispose();
      views.splice(views.indexOf(entry), 1);
      cockpit = undefined;
      sheetFor = undefined;
      pendingSheet = undefined;
    });
  }

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(SIDEBAR_VIEW, {
      resolveWebviewView(view: vscode.WebviewView): void {
        const link = connect(view.webview, 'sidebar', context, hub, tabTracker('sidebar'));
        const entry = { webview: view.webview, reload: () => (view.webview.html = renderHtml(view.webview, context)) };
        views.push(entry);
        view.onDidDispose(() => {
          link.dispose();
          views.splice(views.indexOf(entry), 1);
        });
      },
    }),
    // Wrapped: a command handler receives whatever its caller passes, and only a string names a sheet.
    vscode.commands.registerCommand('kohVibeNext.openCockpit', () => openCockpit()),
    vscode.commands.registerCommand('kohVibeNext.reload', () => {
      for (const v of views) v.reload();
    }),
  );
}

export function deactivate(): void {
  // Everything hangs off context.subscriptions.
}
