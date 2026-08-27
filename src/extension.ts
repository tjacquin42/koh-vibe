import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import * as vscode from 'vscode';
import { claudeHome, claudeSessionsDir, closedFile, groupsFile, kohVibeHome, legacyHome, settingsFile, spoolDirs } from './paths';
import { readLiveSessions } from './claude/registry';
import { rescanLiveSessions } from './claude/rescan';
import { dormantSessions, mergeDormant, parseEditorMemento, readEditorMemento, readStateItem, type ClaudeTab } from './claude/dormant';
import { CLAUDE_STATE_KEY, findTranscript, listingFolder, parseHiddenSessionIds, sessionListedIn } from './claude/listed';
import { locateClaudeTab, revealTabAt, type TabPosition } from './claude/reveal';
import { temporaryToForget } from './store/temporary';
import { visibleSessions } from './store/visible';
import { openSessions } from './store/open';
import { newSessionAmong } from './store/new-session';
import { claims } from './focus/claims';
import { VanishWatch } from './store/vanish';
import { readClosed, rememberClosed } from './closed/store';
import { toClosedEntry, type ClosedEntry } from './closed/model';
import { reopenClosedSession } from './closed/reopen';
import { readSettings, seedSettings, writeSettings } from './settings/store';
import { defaultSettings, settingsFromEditor, type AppSettings } from './settings/model';
import { migrateLegacyHome } from './store/migrate';
import { readUsage, refreshFromApi } from './usage/reader';
import { chimeFor, statusesOf, type ChimeEvent } from './sound/model';
import { availableSounds, NO_SOUND, playFile, playNamed, soundDirs } from './sound/player';
import { EVENT_TITLE, FooterTree, SETTING_TOGGLES, type SettingToggle, type SoundSettings } from './ui/footer-tree';
import { UsageView } from './ui/usage-view';
import { ClosedTree } from './ui/closed-tree';
import { showBusy } from './ui/busy';
import { ensureDirs, hideSession, readSession, readSessions, removeSession } from './spool/persist';
import { SpoolWatcher } from './spool/watcher';
import {
  applyDrop, colorGroupCommand, createGroupCommand, deleteGroupCommand, fileSessionCommand,
  renameGroupCommand, reorderGroupsCommand, runGroupAction, soundGroupCommand, soundSessionCommand,
} from './groups/commands';
import { colorChoice, GROUP_COLORS, NO_COLOR_LABEL } from './ui/colors';
import { readGroups } from './groups/store';
import { CHIME_EVENTS, groupIdOf, soundFor } from './groups/model';
import { installedCount, installLibrary, LIBRARY, librarySoundsDir, removeLibrary } from './sound/library';
import type { TranscriptStats } from './transcript/reader';
import { withTokens } from './transcript/tokens';
import { SessionsTree, groupIdOfNode, sessionIdOfNode } from './ui/tree';
import { decorationColorOf } from './ui/decorations';
import { StatusSummary } from './ui/statusbar';
import { readBuildStamp, versionLabel } from './ui/version';
import { sessionLabel } from './ui/labels';
import { FocusBroker } from './focus/broker';
import { acknowledgeClickedSession, acknowledgeVisibleSessions } from './focus/acknowledge';
import { closeSessionHere, requestCloseSession } from './close/close';
import { claudeTabsOf, closeSessionTab, vscodeTabs } from './close/tabs';
import { countKohEntries } from './hooks/installer';
import type { Session } from './events/types';
import { GUARD_TIMEOUT_MS, ReentrantGuard } from './lib/reentrant-guard';

const REFRESH_MS = 2_000;
/**
 * A second look at the registry after activation. When the editor starts,
 * Claude Code restores its tabs and spawns their processes over several
 * seconds, and the first look — taken before the first render — may run
 * before the last of them is listed. Long enough to cover a slow start,
 * short enough that a conversation removed from the list on purpose is not
 * brought back a minute later.
 */
const RESCAN_LATE_MS = 20_000;
/**
 * How long after a conversation leaves the list a rescan looks for it again.
 * `SessionEnd` runs inside the dying process, which the registry still lists
 * at that instant; a few seconds later a clean exit has removed it, and a twin
 * in another editor — the case this exists for — is the only one left.
 */
const RESCAN_AFTER_VANISH_MS = 5_000;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const home = kohVibeHome();
  // Avant tout le reste : ensureDirs créerait la nouvelle racine et rendrait la
  // reprise impossible — elle ne s'opère que si cette racine n'existe pas encore.
  const migrated = await migrateLegacyHome(legacyHome(), home);
  const dirs = spoolDirs(home);
  const groupsPath = groupsFile(home);
  const settingsPath = settingsFile(home);
  // Donnés une fois, passés partout : le chemin du paquet n'est connu que d'ici,
  // et c'est lui qui porte les deux sons du réglage par défaut.
  const soundPaths = soundDirs(home, context.extensionPath);
  const closedPath = closedFile(home);
  // Claude Code's registry of running processes (`~/.claude/sessions/`): the
  // only source saying that a conversation is alive when its hooks are silent.
  const claudeRoot = claudeHome();
  const registryDir = claudeSessionsDir(claudeRoot);
  // The loading indicator around a rescan: while the flag is raised, the
  // title shows a spinning icon where the Refresh button was (package.json
  // switches the two on this context key), and the view runs its progress
  // bar. Visible at startup too, since the first rescan precedes the first
  // render.
  const RESCANNING = 'kohVibe.rescanning';
  const busy = {
    setBusy: (on: boolean) => vscode.commands.executeCommand('setContext', RESCANNING, on),
    progress: <T>(task: () => Promise<T>) =>
      vscode.window.withProgress({ location: { viewId: 'kohVibe.sessions' } }, task),
  };
  // The editor's own memory of its tabs, kept next to our workspace storage:
  // the one place that knows about a restored Claude tab nobody has opened.
  const stateDb = context.storageUri === undefined ? undefined : join(dirname(context.storageUri.fsPath), 'state.vscdb');
  // The dormant tabs of THIS window (see claude/dormant.ts), in memory only —
  // and the ones the user removed from the list, which stay out until the
  // window reloads: there is no file to mark hidden.
  const dormant = new Map<string, Session>();
  const dismissed = new Set<string>();
  // Every Claude tab of the memento, by session: where a restored tab sits,
  // so that a click brings THAT tab to the front (claude/reveal.ts).
  const dormantTabs = new Map<string, ClaudeTab>();
  const refreshDormant = async (live: ReadonlyMap<string, unknown>): Promise<void> => {
    dormant.clear();
    dormantTabs.clear();
    const folder = workspaceFolders()[0];
    if (stateDb === undefined || folder === undefined) return;
    const raw = await readEditorMemento(stateDb);
    if (raw === undefined) return;
    // Known: what has a process, or an OPEN state file. An ended one does not
    // count — its restored tab makes it dormant, not closed (mergeDormant).
    const open = [...(await readSessions(dirs)).values()].filter((s) => s.endedAt === undefined).map((s) => s.id);
    const known = new Set([...live.keys(), ...open, ...dismissed]);
    const labels = new Set(claudeTabsOf(vscode.window.tabGroups.all).map((t) => t.label));
    const tabs = parseEditorMemento(raw);
    mementoTabs = tabs;
    for (const t of tabs) if (!dormantTabs.has(t.sessionId)) dormantTabs.set(t.sessionId, t);
    for (const d of dormantSessions(tabs, labels, known, folder)) dormant.set(d.id, d);
  };
  // Every Claude tab of the memento, in order: what tells two tabs of one
  // title apart (claude/reveal.ts).
  let mementoTabs: readonly ClaudeTab[] = [];
  /** The tab of a session in this window, when it can be told which one it is. */
  const locateSessionTab = (id: string): { tab: vscode.Tab; pos: TabPosition } | undefined => {
    const want = dormantTabs.get(id);
    if (want === undefined) return undefined;
    const groups = vscode.window.tabGroups.all;
    const pos = locateClaudeTab(groups, want, mementoTabs);
    const tab = pos === undefined ? undefined : groups[pos.group]?.tabs[pos.index];
    return pos === undefined || tab === undefined ? undefined : { tab, pos };
  };
  /**
   * Brings a restored tab to the front, by its position — never through the
   * Claude Code command, which opens a second tab for a conversation it has
   * not registered yet, and a BLANK one when its list does not hold the id.
   * `false` when the tab cannot be told apart.
   */
  const revealSessionTab = async (id: string): Promise<boolean> => {
    const found = locateSessionTab(id);
    return found !== undefined && (await revealTabAt(found.pos));
  };
  /** How long a fresh conversation gets to send its first hook after the tab opened. */
  const NEW_SESSION_WAIT_MS = 20_000;
  const NEW_SESSION_POLL_MS = 300;
  const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
  /**
   * Opens a new Claude Code tab — a fresh conversation, in this window's
   * folder — and, when the click came from a folder, files the conversation
   * there as soon as its first hook names it: left unfiled, it would be a
   * temporary one. The id is only known through the spool, hence the wait.
   */
  const newSession = async (groupId: string | undefined): Promise<void> => {
    const before = new Set((await readSessions(dirs)).keys());
    const since = Date.now();
    try {
      await vscode.commands.executeCommand('claude-vscode.editor.open');
    } catch {
      void vscode.window.showWarningMessage(
        vscode.l10n.t('Koh-Vibe: the Claude Code extension does not expose a command to open a conversation in this version.'),
      );
      return;
    }
    if (groupId === undefined) return;
    const folders = workspaceFolders();
    const isMine = (s: Session): boolean => s.origin === 'vscode' && s.lastEventAt >= since - 1_000 && claims(folders, s.cwd);
    while (Date.now() < since + NEW_SESSION_WAIT_MS) {
      const id = newSessionAmong(before, await readSessions(dirs), isMine);
      if (id !== undefined) {
        await runGroupAction(
          () => fileSessionCommand(groupsPath, id, groupId),
          (message) => void vscode.window.showErrorMessage(message),
        );
        await render();
        return;
      }
      await wait(NEW_SESSION_POLL_MS);
    }
    void vscode.window.showInformationMessage(
      vscode.l10n.t('Koh-Vibe: the new conversation did not show up in time — drag it into the folder yourself.'),
    );
  };
  /**
   * Whether Claude Code's session list, in this window, holds the id — i.e.
   * whether its command would resume the conversation rather than start a
   * blank one (claude/listed.ts). The hidden ids live in the editor's global
   * state, next to our own global storage.
   */
  const globalStateDb = join(dirname(context.globalStorageUri.fsPath), 'state.vscdb');
  const listed = async (id: string): Promise<boolean> => {
    const hidden = parseHiddenSessionIds(await readStateItem(globalStateDb, CLAUDE_STATE_KEY));
    return sessionListedIn(claudeRoot, listingFolder(workspaceFolders()), id, hidden);
  };
  /**
   * Brings back the conversations whose process runs but whose state file is
   * gone (see claude/rescan.ts), then takes stock of the dormant tabs. Never
   * fails: the registry and the editor's memory are conveniences over the
   * hooks, and an unreadable one simply brings nothing back.
   */
  /**
   * Whether a conversation ever got a message. Claude Code writes the
   * transcript on the first one; a session that ends without it never was a
   * conversation — it starts one for every panel it opens, and drops it
   * moments later. The hook's path first, then wherever the file was moved.
   */
  const hasTranscript = async (s: Session): Promise<boolean> =>
    (s.transcriptPath !== undefined && existsSync(s.transcriptPath)) || (await findTranscript(claudeRoot, s.id)) !== undefined;
  const rescan = async (): Promise<string[]> => {
    try {
      const live = await readLiveSessions(registryDir);
      const added = await rescanLiveSessions(dirs, live, Date.now(), claudeRoot);
      // An ended row with nothing to resume — a conversation that never got a
      // message — has no business on screen (see the watcher's `hasTranscript`).
      for (const s of (await readSessions(dirs)).values()) {
        if (s.endedAt !== undefined && !(await hasTranscript(s))) await removeSession(dirs, s.id);
      }
      await refreshDormant(live);
      return added;
    } catch {
      return [];
    }
  };
  await ensureDirs(dirs);
  if (migrated === 'migrated') {
    void vscode.window.showInformationMessage(
      vscode.l10n.t(
        'Koh-Vibe: the extension was renamed. Your folders and sessions were carried over; run "Install hooks" again so that Claude Code points at the new bridge.',
      ),
    );
  }

  // Relu à chaque fois que l'arbre s'apprête à afficher son nœud vide (voir
  // SessionsTree), jamais mis en cache ici : le coût (une lecture de fichier)
  // n'est payé que dans le cas rare où il n'y a aucune session à montrer.
  async function checkHooksInstalled(): Promise<boolean> {
    try {
      const raw = await readFile(join(homedir(), '.claude', 'settings.json'), 'utf8');
      return countKohEntries(JSON.parse(raw)) > 0;
    } catch {
      return false;
    }
  }

  // Le vrai câblage du glisser-déposer : appelle updateGroups au travers
  // d'applyDrop (groups/commands.ts), jamais une écriture directe — voir sa
  // documentation. Un rendu explicite suit l'écriture pour que le dossier se
  // peuple tout de suite à l'écran, sans attendre le minuteur (REFRESH_MS).
  async function onSessionsDropped(
    sessionIds: readonly string[],
    groupId: string | undefined,
    order: readonly string[],
  ): Promise<void> {
    await applyDrop(groupsPath, sessionIds, groupId, order);
    await render();
  }

  async function onGroupsDropped(groupIds: readonly string[], beforeId: string | undefined): Promise<void> {
    await reorderGroupsCommand(groupsPath, groupIds, beforeId);
    await render();
  }

  /**
   * Les réglages du son, tenus dans un fichier PARTAGÉ entre éditeurs.
   *
   * Ils vivaient dans les réglages VSCode, donc dans ceux de chaque éditeur pris
   * séparément : la même machine annonçait « Chute 3 » d'un côté et « Funk » de
   * l'autre. Le classement en dossiers avait déjà tranché la question, et il n'y
   * avait aucune raison que le son y échappe.
   *
   * Relus à chaque rendu et gardés ici : le carillon et les lignes de réglage en
   * ont besoin de façon synchrone, au milieu d'un tour déjà asynchrone.
   */
  let sound: AppSettings = defaultSettings();

  function soundSettings(): SoundSettings {
    return sound;
  }

  /**
   * Flip one of the on/off settings. Nothing else moves: turning "persistent
   * sessions" off changes what the NEXT closed tab does, and the rows already
   * greyed stay where they are.
   */
  async function toggleSetting(key: SettingToggle, on: boolean): Promise<void> {
    if (sound[key] === on) return;
    sound = await writeSettings(settingsPath, key === 'persistent' ? { persistent: on } : { expireTemporary: on });
    await render();
  }

  /** Ce que cet éditeur avait chez lui, et qui ne servira qu'une fois. */
  function legacySettings(): AppSettings {
    const config = vscode.workspace.getConfiguration('kohVibe');
    return settingsFromEditor((key) => config.get(key));
  }

  // Référence du tour précédent pour le carillon. `undefined` = premier rendu :
  // tout y ressemblerait à une transition, et l'éditeur carillonnerait à chaque
  // ouverture de fenêtre pour des sessions parfois vieilles de plusieurs heures.
  let lastStatuses: Map<string, Session['status']> | undefined;

  /** Ce que rejoue la flèche droite, posé le temps d'un choix de son. */
  const PICKING_SOUND = 'kohVibe.pickingSound';

  // Ces libellés sont comparés à ce que l'utilisateur a choisi : les nommer une
  // fois empêche qu'une traduction fasse diverger la question de sa réponse.
  const NONE_LABEL = vscode.l10n.t('None');
  const INSTALL_LABEL = vscode.l10n.t('Install');
  let replay: (() => void) | undefined;

  /**
   * Choisit un son, en le faisant entendre au fil des flèches.
   *
   * `inherit` nomme le niveau au-dessus : « Réglage global » pour un dossier,
   * « Son du dossier » pour une conversation. Le retirer est un choix, distinct
   * de fermer la liste — d'où le retour `{ sound }` plutôt qu'une chaîne, qui
   * confondrait « aucun » et « annulé ».
   */
  async function pickSound(
    title: string,
    inherit: string | undefined,
  ): Promise<{ sound: string | undefined } | undefined> {
    const sounds = await availableSounds(soundPaths);
    if (sounds.length === 0) {
      const go = await vscode.window.showInformationMessage(
        vscode.l10n.t('Koh-Vibe: no sound found on this machine.'),
        vscode.l10n.t('Install the library'),
      );
      if (go !== undefined) await vscode.commands.executeCommand('kohVibe.installSounds');
      return undefined;
    }
    const volume = soundSettings().volume;
    // `createQuickPick` et non `showQuickPick` : lui seul expose
    // `onDidChangeActive`, donc le survol au clavier. Choisir un son sans
    // l'entendre oblige à attendre une vraie bascule pour savoir ce qu'on a pris.
    const picker = vscode.window.createQuickPick();
    picker.title = title;
    picker.placeholder = vscode.l10n.t('The arrow keys play each sound; → replays it');
    picker.items = [
      ...(inherit === undefined
        ? []
        : [{ label: inherit, description: vscode.l10n.t('set nothing at this level') }]),
      { label: NONE_LABEL, description: vscode.l10n.t('silence, even if the level above has a sound') },
      ...sounds.map((s) => ({ label: s.name, description: s.path })),
    ];
    const hear = (label: string | undefined): void => {
      if (label === undefined || label === inherit || label === NONE_LABEL) return;
      void playNamed(label, volume, soundPaths);
    };
    picker.onDidChangeActive((active) => hear(active[0]?.label));
    // La flèche droite ne traverse pas l'API : VSCode n'expose aucun événement
    // clavier sur une liste de choix. Le seul chemin est une commande liée à la
    // touche, activée par un contexte que l'on ne lève QUE pendant ce choix —
    // sans quoi la flèche droite cesserait de déplacer le curseur partout
    // ailleurs dans l'éditeur.
    replay = () => hear(picker.activeItems[0]?.label);
    await vscode.commands.executeCommand('setContext', PICKING_SOUND, true);
    let chosen: string | undefined;
    try {
      chosen = await new Promise<string | undefined>((resolve) => {
        picker.onDidAccept(() => resolve(picker.selectedItems[0]?.label));
        picker.onDidHide(() => resolve(undefined));
        picker.show();
      });
    } finally {
      // Quoi qu'il arrive : un contexte resté levé rendrait la flèche droite
      // inerte dans tout l'éditeur, sans que rien ne dise pourquoi.
      replay = undefined;
      await vscode.commands.executeCommand('setContext', PICKING_SOUND, false);
      picker.dispose();
    }
    if (chosen === undefined) return undefined;
    if (chosen === inherit) return { sound: undefined };
    return { sound: chosen === NONE_LABEL ? NO_SOUND : chosen };
  }

  const tree = new SessionsTree(checkHooksInstalled, onSessionsDropped, onGroupsDropped, context.extensionPath);
  const footer = new FooterTree();
  const usageView = new UsageView(() => void vscode.commands.executeCommand('kohVibe.refreshUsage'));
  const status = new StatusSummary();
  const transcripts = new Map<string, TranscriptStats>();

  // Seul moyen offert par VSCode de colorer le TEXTE d'une ligne d'arbre. Sans
  // état propre : la couleur est portée par l'URI que l'arbre pose sur chaque
  // ligne, donc rien à resynchroniser quand elle change.
  context.subscriptions.push(
    vscode.window.registerFileDecorationProvider({
      provideFileDecoration(uri) {
        const color = decorationColorOf(uri);
        return color === undefined ? undefined : { color: new vscode.ThemeColor(color) };
      },
    }),
  );

  const view = vscode.window.createTreeView('kohVibe.sessions', {
    treeDataProvider: tree,
    dragAndDropController: tree,
  });
  // Vue distincte, sous la première dans le même conteneur : VSCode n'offre
  // aucun moyen d'épingler une ligne au bas d'un arbre, et tout ce qu'on y
  // mettait défilait avec les conversations.
  const closedTree = new ClosedTree();
  const settingsView = vscode.window.createTreeView('kohVibe.settings', { treeDataProvider: footer });
  context.subscriptions.push(
    footer,
    closedTree,
    // Quatre vues empilées dans le conteneur : les sessions, « Fermé
    // récemment » (seulement quand les sessions ne sont pas persistantes), la
    // consommation, puis les réglages. L'ordre vient de package.json, pas d'ici.
    vscode.window.createTreeView('kohVibe.closed', { treeDataProvider: closedTree }),
    vscode.window.registerWebviewViewProvider('kohVibe.usage', usageView),
    settingsView,
    // The checkbox itself; the rest of the row goes through the command.
    settingsView.onDidChangeCheckboxState((e) => {
      for (const [node, state] of e.items) {
        if (node.kind === 'toggle') void toggleSetting(node.key, state === vscode.TreeItemCheckboxState.Checked);
      }
    }),
  );

  // Posée une fois : ni la version ni le commit ne changent tant que la fenêtre
  // vit — un paquet réinstallé n'est vu qu'au rechargement, et c'est justement
  // ce que cette ligne sert à constater.
  view.description = versionLabel(await readBuildStamp(context.extensionPath));

  // Un seul avertissement par cause, jamais un par tick (le minuteur tourne
  // toutes les REFRESH_MS) : même précédent que `warnedMissingCommand` dans
  // FocusBroker.
  let transcriptFailureWarned = false;
  let renderFailureWarned = false;
  let drainFailureWarned = false;
  // Garde de réentrance factorisée (ReentrantGuard) : render() est déclenché
  // par trois sources indépendantes (minuteur, watcher, commande de
  // rafraîchissement), qui peuvent se chevaucher si un rendu est lent — même
  // motif que SpoolWatcher.tick() et FocusBroker.tick().
  const renderGuard = new ReentrantGuard(GUARD_TIMEOUT_MS);

  async function render(): Promise<void> {
    return renderGuard.run(
      async () => {
        // Lu à chaque rendu, comme l'état des sessions : un seul petit fichier,
        // et le pont le réécrit à chaque message de Claude Code. Le mettre en
        // cache ferait afficher un pourcentage périmé — le défaut qu'on a déjà
        // payé trois fois dans ce projet.
        // Interroge l'API au plus toutes les REFRESH_AFTER_MS, quel que soit le
        // nombre de fenêtres : le relevé est mis en cache dans un fichier
        // partagé, et ce rendu-ci ne fait que lire le plus frais des deux.
        void refreshFromApi(home, false);
        usageView.setUsage(await readUsage(home));
        sound = await readSettings(settingsPath);
        footer.setSound(sound);
        footer.setToggles({ persistent: sound.persistent, expireTemporary: sound.expireTemporary });
        footer.setLibrary(await installedCount(librarySoundsDir(home)));
        const map = await withTokens(await readSessions(dirs), transcripts, () => {
          if (transcriptFailureWarned) return;
          transcriptFailureWarned = true;
          void vscode.window.showWarningMessage(
            vscode.l10n.t(
              'Koh-Vibe: a transcript could not be read — this session is shown without its counters.',
            ),
          );
        });
        // The cache follows the list: a conversation that ended, or was removed,
        // must not keep its counters in memory for the life of the window.
        // Pruned AFTER withTokens — `archive` (below) has already read the
        // title it needed before the state file disappeared. The one and only
        // cleanup path: the watcher's callback, below, does not repeat it.
        for (const id of transcripts.keys()) if (!map.has(id)) transcripts.delete(id);
        // What the tab bar shows and the spool does not: this window's dormant
        // tabs — over an ended row, never over an open one (mergeDormant).
        mergeDormant(map, dormant.values());
        // A conversation leaving the list while its process still runs comes
        // back a few seconds later (store/vanish.ts).
        vanish.observe(openSessions(map).keys());
        // Hidden ones stay out of everything the user sees — and in everything
        // that reasons about what is alive (the closed view, the rescan).
        const shown = visibleSessions(map);
        // Re-read on every render, never cached: shared file, another window
        // may have closed a conversation between two rounds. `readClosed` never
        // fails (absent or unreadable means "empty list"). Both, and in this
        // order: the closed view hides an entry whose conversation is back in
        // the list, so it needs the shown ids as much as the list itself.
        const closed = await readClosed(closedPath);
        closedTree.setClosed(closed.closed);
        closedTree.setLive(shown.keys());
        // Relu à chaque rendu, jamais mis en cache : fichier partagé (§3),
        // une autre fenêtre ou un autre éditeur peut l'avoir changé entre deux
        // tours. `readGroups` n'échoue jamais (un fichier absent ou illisible
        // vaut « classement vide », voir groups/store.ts) : aucune garde de
        // type `*FailureWarned` n'est nécessaire ici.
        const groups = await readGroups(groupsPath);
        // Temporary conversations — filed nowhere — leave after a day without
        // activity (store/temporary.ts), when the setting says so. An open one
        // is hidden (the next hook lifts it), an ended one removed for good.
        if (sound.expireTemporary) {
          const filed = (id: string): boolean => {
            const g = groupIdOf(groups, id);
            return g !== undefined && g.length > 0;
          };
          for (const s of temporaryToForget(shown.values(), filed, Date.now())) {
            if (s.endedAt !== undefined) await removeSession(dirs, s.id);
            else await hideSession(dirs, s.id);
            shown.delete(s.id);
          }
        }
        // Le carillon avant l'affichage : `shouldChime` compare l'état du tour
        // précédent au nouveau, et `lastStatuses` doit avancer à CHAQUE rendu,
        // même silencieux — sinon la comparaison se ferait contre un état de
        // plus en plus ancien, et une bascule finirait par sonner deux fois.
        const statuses = statusesOf(shown);
        const changed = chimeFor(lastStatuses, statuses);
        if (changed !== undefined) {
          const global = changed.event === 'waiting' ? sound.waiting : sound.done;
          // Le son de la conversation l'emporte, puis celui de son dossier, puis
          // le réglage global — voir `soundFor`.
          void playNamed(soundFor(groups, changed.sessionId, changed.event, global), sound.volume, soundPaths);
        }
        lastStatuses = statuses;
        // Only while there is nothing to show — the sole case where the hooks
        // row is displayed (I5): the row must notice an installation made
        // while the window is open, and nothing but this loop can observe it
        // (see SessionsTree.setHooksInstalled). The cost is one small file
        // read per tick, paid only on an empty dashboard.
        if (shown.size === 0) tree.setHooksInstalled(await checkHooksInstalled());
        tree.setSessions(shown);
        tree.setGroups(groups);
        // The status bar counts what runs: an ended or dormant row is a
        // conversation to come back to, not a session at work.
        status.update(openSessions(shown));
      },
      () => {
        // Filet générique : quelle que soit la cause restée hors de l'isolation
        // par session ci-dessus, ce rendu échoue seul — jamais les suivants. Le
        // minuteur, le watcher et la commande de rafraîchissement redéclenchent
        // tous render() indépendamment de cet échec.
        if (renderFailureWarned) return;
        renderFailureWarned = true;
        void vscode.window.showWarningMessage(
          vscode.l10n.t('Koh-Vibe: rendering the dashboard failed — it will be retried.'),
        );
      },
    );
  }

  /**
   * Refresh, in full: the registry, then the screen — under the loading
   * indicator for the whole of it, and never shorter than MIN_BUSY_MS. This
   * is what the button, the startup passes and the vanish watch all run.
   */
  const refreshAll = (): Promise<string[]> =>
    showBusy<string[]>(async () => {
      const added = await rescan();
      await render();
      return added;
    }, busy);

  const vanish = new VanishWatch(
    () => void refreshAll(),
    (fire) => {
      const timer = setTimeout(fire, RESCAN_AFTER_VANISH_MS);
      return () => clearTimeout(timer);
    },
  );

  /**
   * The closed-conversation history. `s` is read straight off disk: `title`,
   * and `branch` for anything but a worktree path, are never written to
   * `sessions/<id>.json` — `withTokens` (transcript/tokens.ts) only ever
   * attaches them to the in-memory Map that `render()` holds here, in
   * `transcripts`. Without this lookup, every archived conversation would
   * carry neither, and five closed conversations of the same project would all
   * show the bare project name.
   *
   * Shared by the drain (a natural `SessionEnd`) and, from the next task on, by
   * the trash: two divergent archiving paths would silently lose the title on
   * one of them.
   */
  const archive = async (s: Session): Promise<void> => {
    // A conversation that never got a message has nothing to come back to.
    if (!(await hasTranscript(s))) return;
    const stats = transcripts.get(s.id);
    const source = { ...s, title: s.title ?? stats?.title, branch: s.branch ?? stats?.branch };
    return rememberClosed(closedPath, toClosedEntry(source, Date.now())).then(() => undefined);
  };

  /**
   * Removes a conversation from the dashboard: its state file, then its place
   * in the folder layout — leaving the latter would resurrect a ghost ranking
   * if the id ever came back, and would grow the shared file without end.
   */
  /** The row of a tab just closed: gone for good, and never back through the memento. */
  const remove = async (id: string): Promise<void> => {
    if (dormant.delete(id)) dismissed.add(id);
    await removeSession(dirs, id);
    await render();
  };

  const forget = async (id: string): Promise<void> => {
    // Three kinds of row, three ways out. An open one is hidden, not removed:
    // a removed file is exactly what the rescan brings back. An ended one is
    // removed for good — nothing runs behind it. A dormant tab has no file
    // at all: it leaves this window's memory, and stays out. The folder
    // assignment is kept either way: a conversation that comes back comes
    // back where it was filed.
    const wasDormant = dormant.delete(id);
    if (wasDormant) dismissed.add(id);
    const s = await readSession(dirs, id);
    if (s !== undefined) {
      // A dormant row over an ended file: the file goes with it.
      if (s.endedAt !== undefined) await removeSession(dirs, id);
      else if (!wasDormant) await hideSession(dirs, id);
    }
    await render();
  };

  const broker = new FocusBroker(
    dirs,
    {
      closeHere: (id) =>
        closeSessionHere(id, {
          read: async (i) => (await readSession(dirs, i)) ?? dormant.get(i),
          closeTab: (i) =>
            closeSessionTab(i, {
              ...vscodeTabs(),
              // A tab this window can tell apart is closed directly. The
              // reveal-then-close road is for the others — and never for a
              // dormant tab: the command would open a second, or a blank, one.
              locate: (sessionId) => locateSessionTab(sessionId)?.tab,
              reveal: async (sessionId) => {
                if (dormant.has(sessionId)) throw new Error('restored tab not found');
                await vscode.commands.executeCommand('claude-vscode.editor.open', sessionId);
              },
            }),
          archive,
          forget,
          remove,
        }),
      forget,
    },
    listed,
  );

  const watcher = new SpoolWatcher(
    dirs,
    () => void render(),
    () => {
      if (drainFailureWarned) return;
      drainFailureWarned = true;
      void vscode.window.showWarningMessage(
        vscode.l10n.t('Koh-Vibe: reading the events failed — it will be retried.'),
      );
    },
    Date.now,
    // The closed-conversation history. Errors are NOT swallowed here: `drain`
    // relies on the rejection to leave the event in place and retry it.
    archive,
    // What `SessionEnd` does to the row, per the setting as last read.
    () => (sound.persistent ? 'keep' : 'remove'),
    hasTranscript,
  );
  watcher.start();
  broker.start();

  function workspaceFolders(): string[] {
    return (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath);
  }

  // Acquitte les sessions terminées quand la vue devient visible dans cette
  // fenêtre — mais seulement celles que cette fenêtre revendique (spec §5).
  // acknowledgeVisibleSessions est testée directement (test/acknowledge.test.ts) :
  // le point d'appel lui-même, pas seulement la primitive pure qu'il utilise.
  const onVisible = view.onDidChangeVisibility(async (e) => {
    if (!e.visible) return;
    await acknowledgeVisibleSessions(dirs, workspaceFolders());
  });

  const ticker = setInterval(() => void render(), REFRESH_MS);
  const lateRescan = setTimeout(() => void refreshAll(), RESCAN_LATE_MS);
  // A Claude tab opened or closed changes the dormant set of this window: take
  // stock again, but only when the count of Claude tabs moved — the event fires
  // on every tab switch, and reading the editor's memory is not free.
  let claudeTabCount = claudeTabsOf(vscode.window.tabGroups.all).length;
  const onTabs = vscode.window.tabGroups.onDidChangeTabs(() => {
    const count = claudeTabsOf(vscode.window.tabGroups.all).length;
    if (count === claudeTabCount) return;
    claudeTabCount = count;
    void rescan().then(() => render());
  });

  // Chemin absolu : le terminal lancé par les deux commandes ci-dessous peut
  // avoir n'importe quel répertoire courant, le script n'en dépend pas.
  const installScript = join(context.extensionPath, 'scripts', 'install-hooks.cjs');

  context.subscriptions.push(
    view,
    tree,
    onVisible,
    status,
    { dispose: () => watcher.stop() },
    { dispose: () => broker.stop() },
    { dispose: () => clearInterval(ticker) },
    { dispose: () => clearTimeout(lateRescan) },
    { dispose: () => vanish.dispose() },
    onTabs,
    // Refresh does two things: it brings back every live conversation the
    // spool has lost, then renders. It says so only when it found something —
    // a refresh that changes nothing has nothing to announce.
    vscode.commands.registerCommand('kohVibe.refresh', async () => {
      const added = await refreshAll();
      if (added.length === 0) return;
      void vscode.window.showInformationMessage(
        added.length === 1
          ? vscode.l10n.t('Koh-Vibe: one conversation found again')
          : vscode.l10n.t('Koh-Vibe: {0} conversations found again', added.length),
      );
    }),
    // The spinning icon shown in place of Refresh while a rescan runs. A
    // command because a title button has to be one; it does nothing on
    // purpose, and package.json keeps it disabled.
    vscode.commands.registerCommand('kohVibe.rescanning', () => undefined),
    vscode.commands.registerCommand('kohVibe.focusSession', (s: Session) => {
      // A restored tab is right there in the tab bar: bring it to the front.
      // Only when it cannot be told apart does the Claude Code command take
      // over — which, at worst, resumes the conversation in a second tab.
      if (s.dormant === true) {
        void revealSessionTab(s.id)
          .then((done) => {
            if (done) return;
            // Never the Claude Code command here: it would open the
            // conversation a second time, or a blank one.
            void vscode.window.showInformationMessage(
              vscode.l10n.t('Koh-Vibe: « {0} » is a restored tab this window cannot tell apart — click it in the tab bar.', sessionLabel(s)),
            );
          })
          .catch(() => undefined);
        return;
      }
      // An ended conversation is brought back, not focused: the same three-way
      // decision the closed history used (closed/reopen.ts) — a tab in the
      // window that holds the project, a terminal, or an explanation.
      if (s.endedAt !== undefined) {
        const endedAt = s.endedAt;
        void hasTranscript(s).then((has) => {
          if (has) return reopenClosedSession(toClosedEntry(s, endedAt), (e) => broker.requestReopen(e));
          // Nothing to resume: the row should not even be here (rescan drops such rows).
          void vscode.window.showInformationMessage(
            vscode.l10n.t('Koh-Vibe: « {0} » never got a message — nothing to resume.', sessionLabel(s)),
          );
          return remove(s.id);
        });
        return;
      }
      // Le clic acquitte inconditionnellement (spec §5 : « clic sur la
      // session »), indépendamment de claims() — qui ne gouverne que
      // l'acquittement passif d'acknowledgeVisibleSessions, ci-dessus.
      // acknowledgeClickedSession est testée directement, comme sa jumelle.
      void acknowledgeClickedSession(dirs, s).catch(() => undefined);
      void broker.request(s).catch(() => undefined);
    }),
    /**
     * The trash on a live conversation. The three-part decision — nothing to
     * close, ask first, route — belongs to requestCloseSession (close/close.ts)
     * and is tested there, for the same reason reopenClosedSession was pulled
     * out of this file: a composition point living directly in extension.ts has
     * no automated coverage.
     */
    vscode.commands.registerCommand('kohVibe.closeSession', async (node: unknown) => {
      const id = sessionIdOfNode(node);
      if (id === undefined) return;
      // A dormant tab is closable too — first: over an ended file, the tab
      // is the thing to close, and the file goes with it (`remove`).
      const s = dormant.get(id) ?? (await readSession(dirs, id));
      // Already gone from the spool: nothing to close, and nothing to remove.
      if (s === undefined) return;
      // Nothing runs behind an ended row: the trash removes it for good.
      if (s.endedAt !== undefined) {
        await forget(id);
        return;
      }
      await requestCloseSession(s, {
        confirm: async (target) =>
          (await vscode.window.showWarningMessage(
            vscode.l10n.t(
              'Close « {0} »? This conversation is still active — closing its tab ends it.',
              sessionLabel(target),
            ),
            { modal: true },
            vscode.l10n.t('Close'),
          )) !== undefined,
        route: (target) => broker.requestClose(target),
        forget,
      }).catch(() => {
        // Surfaced, never swallowed: the click would otherwise do and say
        // nothing at all. Same precedent as reopenClosedSession (closed/
        // reopen.ts), where a silently swallowed failure left a section whose
        // only gesture IS that click doing nothing.
        void vscode.window.showErrorMessage(
          vscode.l10n.t('Koh-Vibe: could not close « {0} ».', sessionLabel(s)),
        );
      });
    }),
    vscode.commands.registerCommand('kohVibe.installHooks', () => {
      const terminal = vscode.window.createTerminal('Koh-Vibe');
      terminal.sendText(`node "${installScript}"`);
      terminal.show();
      // Proposé ici, une seule fois, et jamais imposé : c'est le moment où l'on
      // installe, donc le moment où la question a un sens. `void` — la question
      // ne doit pas retarder l'installation elle-même.
      void vscode.commands.executeCommand('kohVibe.offerSounds');
    }),
    vscode.commands.registerCommand('kohVibe.offerSounds', async () => {
      // Rien à proposer si la bibliothèque est déjà posée : une question sans
      // objet est du bruit.
      if ((await installedCount(librarySoundsDir(home))) > 0) return;
      const go = await vscode.window.showInformationMessage(
        vscode.l10n.t(
          'Koh-Vibe can install {0} short interface sounds ({1}, {2}).',
          LIBRARY.count,
          LIBRARY.name,
          LIBRARY.license,
        ),
        INSTALL_LABEL,
        vscode.l10n.t('Later'),
      );
      if (go === INSTALL_LABEL) await vscode.commands.executeCommand('kohVibe.installSounds');
    }),
    vscode.commands.registerCommand('kohVibe.uninstallHooks', () => {
      const terminal = vscode.window.createTerminal('Koh-Vibe');
      terminal.sendText(`node "${installScript}" --uninstall`);
      terminal.show();
    }),
    // Les trois commandes de dossier partagent le même filet : runGroupAction
    // (groups/commands.ts) transforme tout ce que la décision lève — en
    // particulier le nom vide, que createGroup/renameGroup rejettent
    // volontairement — en message affiché, jamais en trace d'appel non gérée.
    vscode.commands.registerCommand('kohVibe.newSession', () => newSession(undefined)),
    vscode.commands.registerCommand('kohVibe.newSessionInGroup', (node: unknown) => newSession(groupIdOfNode(node))),
    vscode.commands.registerCommand('kohVibe.newGroup', async () => {
      const label = await vscode.window.showInputBox({
        prompt: vscode.l10n.t('Folder name'),
        placeHolder: vscode.l10n.t('Personal'),
      });
      await runGroupAction(
        () => createGroupCommand(groupsPath, label, () => randomUUID()),
        (message) => void vscode.window.showErrorMessage(message),
      );
      await render();
    }),
    vscode.commands.registerCommand('kohVibe.renameGroup', async (node: unknown) => {
      const id = groupIdOfNode(node);
      if (id === undefined) return;
      const label = await vscode.window.showInputBox({ prompt: vscode.l10n.t('New folder name') });
      await runGroupAction(
        () => renameGroupCommand(groupsPath, id, label),
        (message) => void vscode.window.showErrorMessage(message),
      );
      await render();
    }),
    vscode.commands.registerCommand('kohVibe.refreshUsage', async () => {
      // `force` : sans lui ce bouton attendrait l'échéance comme un rendu
      // ordinaire, et ne rafraîchirait rien.
      const reading = await refreshFromApi(home, true);
      await render();
      if (reading === undefined) {
        void vscode.window.showInformationMessage(
          vscode.l10n.t(
            'Koh-Vibe: usage unavailable — Anthropic unreachable, or keychain access denied.',
          ),
        );
      }
    }),
    vscode.commands.registerCommand('kohVibe.replaySound', () => replay?.()),
    vscode.commands.registerCommand('kohVibe.chooseSound', async (event: unknown) => {
      const which: ChimeEvent = event === 'done' ? 'done' : 'waiting';
      // Pas de niveau au-dessus : c'est le réglage global, le dernier recours.
      const chosen = await pickSound(EVENT_TITLE[which](), undefined);
      if (chosen === undefined) return;
      await writeSettings(settingsPath, { [which]: chosen.sound ?? NO_SOUND });
      await render();
    }),
    // The three-way decision (terminal / editor tab / explain) is not made
    // here: reopenClosedSession (closed/reopen.ts) owns it, and is tested
    // directly — see focus/acknowledge.ts for the same reasoning.
    vscode.commands.registerCommand('kohVibe.reopenSession', (entry: ClosedEntry) =>
      reopenClosedSession(entry, (e) => broker.requestReopen(e)),
    ),
    vscode.commands.registerCommand('kohVibe.toggleSetting', (key: unknown) => {
      const toggle = SETTING_TOGGLES.find((k) => k === key);
      return toggle === undefined ? undefined : toggleSetting(toggle, !sound[toggle]);
    }),
    vscode.commands.registerCommand('kohVibe.chooseVolume', async () => {
      const settings = soundSettings();
      const steps = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
      const sounds = await availableSounds(soundPaths);
      // Le son d'essai est celui déjà choisi ; à défaut, le premier venu — sans
      // quoi régler le volume avant d'avoir choisi un son se ferait en silence.
      const sample = sounds.find((s) => s.name === settings.waiting) ?? sounds[0];
      const picker = vscode.window.createQuickPick();
      picker.title = vscode.l10n.t('Chime volume');
      picker.placeholder = vscode.l10n.t('The arrow keys play each level');
      picker.items = steps.map((p) => ({ label: `${p} %` }));
      picker.onDidChangeActive((active) => {
        const item = active[0];
        if (item === undefined || sample === undefined) return;
        playFile(sample.path, Number.parseInt(item.label, 10) / 100);
      });
      const chosen = await new Promise<string | undefined>((resolve) => {
        picker.onDidAccept(() => resolve(picker.selectedItems[0]?.label));
        picker.onDidHide(() => resolve(undefined));
        picker.show();
      });
      picker.dispose();
      if (chosen === undefined) return;
      await writeSettings(settingsPath, { volume: Number.parseInt(chosen, 10) / 100 });
      await render();
    }),
    vscode.commands.registerCommand('kohVibe.installSounds', async () => {
      const target = librarySoundsDir(home);
      const already = await installedCount(target);
      if (already > 0) {
        void vscode.window.showInformationMessage(
          vscode.l10n.t('Koh-Vibe: the library is already installed ({0} sounds).', already),
        );
        return;
      }
      const go = await vscode.window.showInformationMessage(
        vscode.l10n.t('Install {0} interface sounds?', LIBRARY.count),
        {
          modal: true,
          detail: vscode.l10n.t(
            '{0}, by {1} — {2}, so free for any use.\nAround 2 MB downloaded once (3 MB on disk), placed in {3}, and removable in one click.',
            LIBRARY.name,
            LIBRARY.author,
            LIBRARY.license,
            target,
          ),
        },
        INSTALL_LABEL,
      );
      if (go !== INSTALL_LABEL) return;
      const added = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: vscode.l10n.t('Koh-Vibe: installing sounds…') },
        () => installLibrary(target),
      );
      void vscode.window.showInformationMessage(
        added === 0
          ? vscode.l10n.t('Koh-Vibe: the library could not be installed — network unreachable?')
          : vscode.l10n.t('Koh-Vibe: {0} sounds installed.', added),
      );
      await render();
    }),
    vscode.commands.registerCommand('kohVibe.removeSounds', async () => {
      const target = librarySoundsDir(home);
      const present = await installedCount(target);
      if (present === 0) {
        void vscode.window.showInformationMessage(vscode.l10n.t('Koh-Vibe: the library is not installed.'));
        return;
      }
      const remove = vscode.l10n.t('Remove');
      const go = await vscode.window.showWarningMessage(
        vscode.l10n.t('Remove the {0} sounds of the library?', present),
        {
          modal: true,
          detail: vscode.l10n.t(
            'Only {0} is erased: the system sounds and your own stay put.',
            target,
          ),
        },
        remove,
      );
      if (go !== remove) return;
      void vscode.window.showInformationMessage(
        vscode.l10n.t('Koh-Vibe: {0} sounds removed.', await removeLibrary(target)),
      );
      await render();
    }),
    // Deux commandes par niveau, une par événement, plutôt qu'une seule qui
    // demanderait ensuite « lequel ? » : le menu doit dire ce qu'on va régler
    // avant de l'ouvrir, sinon on choisit un son sans savoir quand il sonnera.
    ...CHIME_EVENTS.flatMap((event) => [
      vscode.commands.registerCommand(`kohVibe.soundGroup.${event}`, async (node: unknown) => {
        const id = groupIdOfNode(node);
        if (id === undefined) return;
        const chosen = await pickSound(vscode.l10n.t('{0} — this folder', EVENT_TITLE[event]()), vscode.l10n.t('Global setting'));
        if (chosen === undefined) return;
        await runGroupAction(
          () => soundGroupCommand(groupsPath, id, event, chosen.sound),
          (message) => void vscode.window.showErrorMessage(message),
        );
        await render();
      }),
      vscode.commands.registerCommand(`kohVibe.soundSession.${event}`, async (node: unknown) => {
        const id = sessionIdOfNode(node);
        if (id === undefined) return;
        const chosen = await pickSound(vscode.l10n.t('{0} — this conversation', EVENT_TITLE[event]()),
          vscode.l10n.t('Folder sound'),
        );
        if (chosen === undefined) return;
        await runGroupAction(
          () => soundSessionCommand(groupsPath, id, event, chosen.sound),
          (message) => void vscode.window.showErrorMessage(message),
        );
        await render();
      }),
    ]),
    /**
     * Retire une conversation du tableau de bord.
     *
     * Ne tue rien : Claude Code tourne dans son terminal, et cette extension
     * n'en connaît que les traces. Une session ENCORE VIVANTE réapparaîtra donc
     * à son prochain événement — ou au prochain Rafraîchir, qui relit le
     * registre des processus. C'est voulu, et le libellé du menu le dit
     * (« retirer de la liste », pas « fermer »), plutôt que de laisser croire à
     * un arrêt qui n'a pas eu lieu.
     */
    vscode.commands.registerCommand('kohVibe.forgetSession', async (node: unknown) => {
      const id = sessionIdOfNode(node);
      if (id === undefined) return;
      try {
        await forget(id);
      } catch {
        void vscode.window.showErrorMessage(vscode.l10n.t('Koh-Vibe: this conversation could not be removed.'));
      }
    }),
    vscode.commands.registerCommand('kohVibe.colorGroup', async (node: unknown) => {
      const id = groupIdOfNode(node);
      if (id === undefined) return;
      const pick = await vscode.window.showQuickPick(
        [NO_COLOR_LABEL, ...GROUP_COLORS.map((c) => c.label)],
        { placeHolder: vscode.l10n.t('Folder colour') },
      );
      // Fermer la liste n'efface rien : la distinction vit dans colorChoice.
      const choice = colorChoice(pick);
      if (choice.kind === 'cancel') return;
      await runGroupAction(
        () => colorGroupCommand(groupsPath, id, choice.color),
        (message) => void vscode.window.showErrorMessage(message),
      );
      await render();
    }),
    vscode.commands.registerCommand('kohVibe.deleteGroup', async (node: unknown) => {
      const id = groupIdOfNode(node);
      if (id === undefined) return;
      await runGroupAction(
        () => deleteGroupCommand(groupsPath, id),
        (message) => void vscode.window.showErrorMessage(message),
      );
      await render();
    }),
  );

  // Avant le premier rendu : le fichier partagé n'existe pas encore chez qui
  // vient de mettre à jour, et il faut y verser ce que CET éditeur avait dans
  // ses propres réglages. Le premier démarré fixe la valeur ; les suivants la
  // lisent — voir seedSettings, qui ne réécrit jamais un fichier présent.
  await seedSettings(settingsPath, legacySettings);
  // Before the first render, so that a conversation lost while this window was
  // away — ended by a window reload before its tab was resumed, or removed by
  // hand — is back on screen at once.
  await refreshAll();
}

export function deactivate(): void {
  // Toutes les ressources sont enregistrées dans context.subscriptions.
}
