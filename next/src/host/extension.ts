import * as vscode from 'vscode';
import { readFile } from 'node:fs/promises';
import { countKohEntries } from '../../../src/hooks/installer';
import { realEngine, startEngine, type EngineDeps } from './engine';
import { ActiveTab } from './active-tab';
import { adapted, asCustomizations, type IdeBackup } from './ide-theme';
import { DEFAULT_THEME, parseTheme } from '../shared/theme';
import { readClosed } from '../../../src/closed/store';
import { artifactProjectsFile, claudeHome, claudeSessionsDir, closedFile, groupsFile, kohVibeHome, settingsFile, spoolDirs } from '../../../src/paths';
import { readSessions } from '../../../src/spool/persist';
import { parseViewMessage, type ActiveTabView, type HostMessage, type ReopenOutcome, type SidebarTab, type Surface, type ViewContext } from '../shared/protocol';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { FOLDER_COLOR_IDS, LANGUAGE_CHOICES, type Action, type ActionResult, type FolderColor, type LanguageChoice } from '../shared/actions';
import { parseTabsMode, tabsTarget } from '../../../src/settings/tabs';
import { MENU_ITEMS, runMenu, type MenuDeps } from './menus';
import { applyMoves, ensureTidyRulesFile, parseMoves, readTidyRules, runClaude, tidyPrompt, tidyRulesFile, type TidyItem } from './tidy';
import { SKILL_NAME } from '../../../src/skill/install';
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

/** A folder colour's name, as V1's picker says it (src/ui/colors.ts). */
function colorName(id: FolderColor): string {
  const names: Record<FolderColor, string> = {
    blue: vscode.l10n.t('Blue'),
    indigo: vscode.l10n.t('Indigo'),
    cyan: vscode.l10n.t('Cyan'),
    green: vscode.l10n.t('Green'),
    lime: vscode.l10n.t('Lime'),
    yellow: vscode.l10n.t('Yellow'),
    orange: vscode.l10n.t('Orange'),
    red: vscode.l10n.t('Red'),
    pink: vscode.l10n.t('Pink'),
    purple: vscode.l10n.t('Purple'),
  };
  return names[id];
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
/** The language picked in the settings (kept by the editor, across starts); `auto` when none. */
const LANGUAGE_KEY = 'kohVibeNext.language';
function languageChoiceOf(context: vscode.ExtensionContext): LanguageChoice {
  const v: unknown = context.globalState.get(LANGUAGE_KEY);
  return LANGUAGE_CHOICES.find((c) => c === v) ?? 'auto';
}

/** Koh-Vibe's colours (shared/theme.ts), kept by the editor for every view. */
const THEME_KEY = 'kohVibeNext.theme';
/** Names beside the tab icons (default on), for the sidebar and the cockpit alike. */
const TAB_NAMES_KEY = 'kohVibeNext.tabNames';
/** Lines a conversation's title may take (1 or 2), for every view. */
const TITLE_LINES_KEY = 'kohVibeNext.titleLines';
/** The editor's colour customizations as they were before « Adapt to the IDE » (ide-theme.ts). */
const IDE_BACKUP_KEY = 'kohVibeNext.ideColorsBackup';
/** Whether Tidy asks before running the agent (default yes), kept by the editor. */
const TIDY_ASK_KEY = 'kohVibeNext.tidyAsk';
/** Where the agent's rules were kept before they moved to a file (tidy.ts): moved there once. */
const OLD_TIDY_RULES_KEY = 'kohVibeNext.tidyRules';

/** The editor's tab bar setting, read where it lives (V1 settings/tabs.ts). */
const editorConfig = (): vscode.WorkspaceConfiguration => vscode.workspace.getConfiguration('workbench.editor');

/** One per activation: see ViewContext.launch. */
const launch = randomUUID();

function connect(
  webview: vscode.Webview,
  surface: Surface,
  context: vscode.ExtensionContext,
  hub: Hub,
  actions: ViewActions,
): Disposable {
  webview.options = webviewOptions(context);
  webview.html = renderHtml(webview, context);
  // Read at every start of the view: a reload after a change of language must see the new one.
  const viewContext = (): ViewContext => {
    const choice = languageChoiceOf(context);
    return {
    surface,
    language: choice === 'auto' ? vscode.env.language : choice,
    languageChoice: choice,
    version: versionOf(context.extension.packageJSON as unknown),
    launch,
    };
  };
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
/** Overridable by tests, which must not read the machine's own Claude Code settings. */
export const claudeSettings: { current: string | undefined } = { current: undefined };

/** Whether Koh-Vibe's hooks are in Claude Code's settings — V1's own count (hooks/installer.ts). */
async function hooksInstalledNow(): Promise<boolean> {
  try {
    const raw = await readFile(claudeSettings.current ?? join(homedir(), '.claude', 'settings.json'), 'utf8');
    return countKohEntries(JSON.parse(raw)) > 0;
  } catch {
    return false;
  }
}

/** Overridable by tests, which must not run V1's engine in a stubbed editor. */
export const engineDeps: { current: EngineDeps } = { current: realEngine };
/** Overridable by tests, which must not read the machine's transcripts. */
export const transcriptsRoot: { current: string | undefined } = { current: undefined };

/** Tab changes, and group changes — the tab in front changes with the group in front. */
function watchActiveTab(changed: () => void): vscode.Disposable[] {
  const tabGroups = vscode.window.tabGroups as vscode.TabGroups | undefined;
  return tabGroups === undefined ? [] : [tabGroups.onDidChangeTabs(changed), tabGroups.onDidChangeTabGroups(changed)];
}

export function activate(context: vscode.ExtensionContext): void {
  const home = kohVibeHome();
  const output = vscode.window.createOutputChannel('Koh-Vibe Next');
  // The switch-over: V1's engine runs here once V1 itself is gone (engine.ts).
  void startEngine(context, engineDeps.current, (line) => output.appendLine(`${new Date().toISOString()} ${line}`));
  const procs = processDeps.current ?? systemProcessDeps(claudeSessionsDir(claudeHome()));
  const rulesFile = tidyRulesFile(home);
  const oldRules: unknown = context.globalState.get(OLD_TIDY_RULES_KEY);
  if (Array.isArray(oldRules)) {
    const rules = oldRules.filter((r): r is string => typeof r === 'string');
    void (rules.length === 0 ? Promise.resolve() : ensureTidyRulesFile(rulesFile, rules))
      .then(() => context.globalState.update(OLD_TIDY_RULES_KEY, undefined))
      .then(undefined, (e: unknown) => output.appendLine(`tidy rules → not moved to ${rulesFile}: ${String(e)}`));
  }
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
  // The conversation tab in front (active-tab.ts), through the editor's memento
  // in this workspace's storage — the same database V1 reads.
  const activeTab = new ActiveTab(context.storageUri === undefined ? undefined : join(dirname(context.storageUri.fsPath), 'state.vscdb'));
  const activeTabExtra = async (): Promise<{ activeTab?: ActiveTabView }> => {
    const a = await activeTab.current(Date.now());
    return a === undefined ? {} : { activeTab: a };
  };
  const hub = new Hub({
    build: async () => {
      // The shared lists, asked again only while a view shows them and at
      // most every five minutes (Feed): a write lands in the cache file,
      // which the watcher turns into the next build.
      for (const what of ['artifacts', 'routines'] as const) {
        if ([...tabs.values()].includes(what)) void cloud.refresh(what, false);
      }
      if (names === 'cold') void warmNames();
      const editorTabs = parseTabsMode(editorConfig().get('showTabs'));
      return buildSnapshot(home, Date.now(), {
        editorTabs,
        tidy: { ask: context.globalState.get(TIDY_ASK_KEY) !== false, rules: await readTidyRules(rulesFile) },
        theme: parseTheme(context.globalState.get(THEME_KEY)) ?? DEFAULT_THEME,
        ideThemed: context.globalState.get(IDE_BACKUP_KEY) !== undefined,
        tabNames: context.globalState.get(TAB_NAMES_KEY) !== false,
        titleLines: context.globalState.get(TITLE_LINES_KEY) === 2 ? 2 : 1,
        ...(await activeTabExtra()),
        hooksInstalled: await hooksInstalledNow(),
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
  context.subscriptions.push(
    output,
    hub,
    statusBar,
    hub.subscribe((snap) => statusBar.update(snap)),
    // The tab bar changed from the editor's own settings: the settings panel follows.
    // Another tab in front: the list marks its conversation.
    ...watchActiveTab(() => {
      activeTab.forget();
      void hub.refresh();
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('workbench.editor.showTabs')) void hub.refresh();
    }),
  );

  /** One tab tracker per view; a switch to Processes rebuilds at once rather than at the next poll. */
  const focus = (sessionId: string): void => {
    void openSession(sessionId, {
      read: async (id) => (await readSessions(spoolDirs(home))).get(id),
      hasCommand: async (cmd) => (await vscode.commands.getCommands(true)).includes(cmd),
      run: (cmd, arg) => vscode.commands.executeCommand(cmd, arg),
      runById: (cmd, id) => vscode.commands.executeCommand(cmd, id),
      fallback: (id) => openCockpit(id),
    });
  };

  const menuDeps: MenuDeps = {
    act: (a) => act(a),
    open: (id) => focus(id),
    sheet: (id) => openCockpit(id),
    reopen: (id) => void reopen(id),
    openUrl: (url) => void vscode.env.openExternal(vscode.Uri.parse(url)),
    ask: (prompt, value) => vscode.window.showInputBox({ prompt, value }),
    pickColor: async (current) => {
      const none = vscode.l10n.t('No color');
      const items = [none, ...FOLDER_COLOR_IDS.map((c) => colorName(c))].map((label, i) => ({
        label,
        description: (i === 0 ? current === undefined : FOLDER_COLOR_IDS[i - 1] === current) ? '●' : '',
        id: i === 0 ? null : (FOLDER_COLOR_IDS[i - 1] ?? null),
      }));
      const picked = await vscode.window.showQuickPick(items, { placeHolder: vscode.l10n.t('Folder color') });
      return picked === undefined ? undefined : picked.id;
    },
    confirm: async (message, yes) => (await vscode.window.showWarningMessage(message, { modal: true }, yes)) === yes,
    t: (message, ...args) => vscode.l10n.t(message, ...args),
    report: (r) => {
      if (r.ok) return;
      const text = {
        'v1-missing': vscode.l10n.t('This goes through Koh-Vibe (V1) until the switch-over, and it is not installed here.'),
        cloud: vscode.l10n.t('claude.ai did not take it (signed out, or refused). The « Koh-Vibe Next » output says why.'),
        stale: vscode.l10n.t('That changed in the meantime: nothing was done.'),
        failed: vscode.l10n.t('That did not go through. Nothing was changed.'),
      }[r.error];
      void vscode.window.showWarningMessage(`Koh-Vibe: ${text}`);
    },
  };

  // The tidying agent (tidy.ts): one run at a time, on the freshest list.
  let tidying = false;
  const tidy = async (): Promise<ActionResult> => {
    if (tidying) return { ok: true, count: 0 };
    tidying = true;
    try {
      await cloud.refresh('artifacts', true);
      const snap = await buildSnapshot(home, Date.now());
      const items: TidyItem[] = (snap.artifacts?.items ?? []).map((a) => (a.project === undefined ? { slug: a.slug, title: a.title } : { slug: a.slug, title: a.title, project: a.project }));
      if (items.length === 0) return { ok: true, count: 0 };
      const projects = [...new Set(items.map((i) => i.project).filter((p): p is string => p !== undefined))];
      const answer = await runClaude(tidyPrompt(items, projects, await readTidyRules(rulesFile)), (line) => output.appendLine(`${new Date().toISOString()} ${line}`));
      if (answer === undefined) return { ok: false, error: 'failed' };
      const moves = parseMoves(answer, items);
      await applyMoves(artifactProjectsFile(home), moves);
      void hub.refresh();
      return { ok: true, count: moves.length };
    } finally {
      tidying = false;
    }
  };

  const reopen = (sessionId: string): Promise<ReopenOutcome> =>
    reopenClosed(sessionId, {
      read: async (id) => (await readClosed(closedFile(home))).closed.find((e) => e.id === id),
      hasCommand: async (cmd) => (await vscode.commands.getCommands(true)).includes(cmd),
      run: (cmd, arg) => vscode.commands.executeCommand(cmd, arg),
    });

  // « Adapt the theme to the IDE » (ide-theme.ts): written to the user's
  // settings (every window, every workspace), the original kept once in the
  // editor's state and given back whole.
  const ideTheme = async (mode: 'adapt' | 'restore'): Promise<void> => {
    const workbench = vscode.workspace.getConfiguration('workbench');
    const backup = context.globalState.get<IdeBackup>(IDE_BACKUP_KEY);
    if (mode === 'restore') {
      if (backup === undefined) return;
      await workbench.update('colorCustomizations', backup.value ?? undefined, vscode.ConfigurationTarget.Global);
      await context.globalState.update(IDE_BACKUP_KEY, undefined);
      return;
    }
    const original = backup !== undefined ? backup.value : asCustomizations(workbench.inspect('colorCustomizations')?.globalValue);
    if (backup === undefined) await context.globalState.update(IDE_BACKUP_KEY, { value: original } satisfies IdeBackup);
    const tune = (parseTheme(context.globalState.get(THEME_KEY)) ?? DEFAULT_THEME).current;
    await workbench.update('colorCustomizations', adapted(original, tune, workbench.get<string>('colorTheme')), vscode.ConfigurationTarget.Global);
  };

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
      // Written where it is SEEN: the narrowest scope already setting it (V1 tabsTarget).
      setEditorTabs: async (mode) => {
        const target = tabsTarget(editorConfig().inspect('showTabs') ?? {});
        await editorConfig().update(
          'showTabs',
          mode,
          target === 'workspaceFolder' ? vscode.ConfigurationTarget.WorkspaceFolder : target === 'workspace' ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global,
        );
      },
      // Every view starts again in the new language: its strings are built at load.
      setLanguage: async (choice) => {
        await context.globalState.update(LANGUAGE_KEY, choice);
        for (const v of views) v.reload();
      },
      tidy: () => tidy(),
      setTidyAsk: (ask) => context.globalState.update(TIDY_ASK_KEY, ask),
      // Said once done: the editor repaints, but the click gave no other sign.
      ideTheme: async (mode) => {
        await ideTheme(mode);
        void vscode.window.showInformationMessage(
          mode === 'adapt'
            ? vscode.l10n.t('Koh-Vibe: the editor now wears Koh-Vibe’s colours. « Back to default » puts yours back.')
            : vscode.l10n.t('Koh-Vibe: the editor’s colours are back as they were.'),
        );
      },
      setTabNames: (on) => context.globalState.update(TAB_NAMES_KEY, on),
      setTitleLines: (lines) => context.globalState.update(TITLE_LINES_KEY, lines),
      // The editor's colours are not followed: they change on a click of « Adapt » only (14/11).
      setTheme: (theme) => context.globalState.update(THEME_KEY, theme),
      // As a folder rule (V1 groups/rules.ts): a conversation that starts with
      // a title, the skill and the file, left in the input unsent.
      tidyRules: async (mode) => {
        await ensureTidyRulesFile(rulesFile);
        if (mode === 'open') {
          await vscode.window.showTextDocument(vscode.Uri.file(rulesFile));
          return;
        }
        await vscode.commands.executeCommand(
          'claude-vscode.editor.open',
          undefined,
          vscode.l10n.t(
            'Artifact tidying rule\n\nUse the {0} skill. The rules of the Koh-Vibe agent that files the claude.ai artifacts under projects are in {1}.\nAsk me which rule to add.',
            SKILL_NAME,
            rulesFile,
          ),
        );
      },
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
    adoptCockpit(
      vscode.window.createWebviewPanel(COCKPIT_PANEL, 'Koh-Vibe', vscode.ViewColumn.Active, {
        ...webviewOptions(context),
        retainContextWhenHidden: true,
      }),
    );
  }

  /**
   * A cockpit tab, new or restored: VSCode reopens the one left open, in its
   * place, when the editor reloads (the serializer below), and this wires it
   * up exactly as a new one.
   */
  function adoptCockpit(panel: vscode.WebviewPanel): void {
    cockpit?.dispose();
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
      // Only if it is still the one: a restored tab may have replaced it.
      if (cockpit !== panel) return;
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
    // The cockpit left open is put back where it was when the editor reloads.
    vscode.window.registerWebviewPanelSerializer(COCKPIT_PANEL, {
      deserializeWebviewPanel: async (panel: vscode.WebviewPanel) => adoptCockpit(panel),
    }),
    // Wrapped: a command handler receives whatever its caller passes, and only a string names a sheet.
    vscode.commands.registerCommand('kohVibeNext.openCockpit', () => openCockpit()),
    vscode.commands.registerCommand('kohVibeNext.reload', () => {
      for (const v of views) v.reload();
    }),
    // The right-click menus (menus.ts): VSCode hands each the row's data-vscode-context.
    ...MENU_ITEMS.map((m) => vscode.commands.registerCommand(m.command, (arg: unknown) => runMenu(m.command, arg, menuDeps))),
  );
}

export function deactivate(): void {
  // Everything hangs off context.subscriptions.
}
