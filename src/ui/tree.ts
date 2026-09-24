import * as vscode from 'vscode';
import type { Session, Status } from '../events/types';
import { sessionDescription, sessionLabel, sessionTooltip, statusLabel } from './labels';
import { emptyGroups, groupIdOf, reorder, sessionOrderOf, type Group, type GroupsState } from '../groups/model';
import { shownColor, themeColorOf, type ColorPreview } from './colors';
import { decorationUriParts } from './decorations';
import { statusIconPath } from './status-icon';
import { isOpen } from '../store/open';
import type { SessionProcess } from '../process/classify';
import { childrenOf, glyphOf, hasChildren, processCount, processDescription, processItem, rootsOf } from './process-labels';

export type TreeNode =
  // `group: undefined` names « Unfiled », the leftover of sessions not
  // filed — not a folder in the user's sense, see contextValue further down.
  | { kind: 'group'; group: Group | undefined; sessions: Session[] }
  | { kind: 'session'; session: Session }
  // A process the session started, unfolded under it. Carries the session it
  // belongs to as well as the process: a pid alone is not a stable identity —
  // the system reuses them — and the row has to be attributable to a
  // conversation for the context menu to say what killing it would cost.
  | { kind: 'process'; sessionId: string; proc: SessionProcess }
  // An empty row between two folders. VSCode offers no spacing setting for
  // a tree view: the only margin an extension can put down is a row. It
  // therefore carries no command, no contextValue, no identifier —
  // nothing that would make it clickable or a target for a drop.
  | { kind: 'spacer'; after: string }
  // The usage measured by Claude Code, at the head of the view. Absent as
  // long as the statusline bridge is not installed — in which case the row
  // does not exist, rather than showing zero and suggesting a null usage.
  // `action` distinguishes « the hooks need installing », clickable, from
  // « nothing to show », which must trigger nothing.
  | { kind: 'empty'; message: string; action?: 'install' };

/**
 * Each status's dot is a disc, identical for all five: only the colour tells
 * them apart.
 *
 * The shape is deliberately the same everywhere. Different glyphs — `check`,
 * `question`, `circle-outline`, `circle-slash` — did not land at the same spot
 * in the row, and the label that follows them inherited the offset: the
 * conversations did not line up. A single disc makes the alignment true by
 * construction, and no longer by luck — and with the five statuses now going
 * through the same rendering path (an image), nothing shifts them any more.
 *
 * What is lost — the shape of the triangle, of the check mark — is recovered
 * in the tooltip and in the accessibility label, which name the status.
 *
 * The choice of the image over the coloured codicon is explained in
 * ./status-icon.
 */

const ORDER: Record<Status, number> = { waiting: 0, running: 1, done_unseen: 2, idle: 3 };

/**
 * Three tiers before any status: what runs, then the tabs nobody has woken,
 * then what ended — the most recently ended first. Within the first tier the
 * status decides, then recency, as the dashboard always sorted.
 */
function tierOf(s: Session): number {
  // A restored tab is an OPEN session to the user — it is right there in the
  // tab bar — so it sorts with the open ones, as the idle one it reads as.
  if (s.endedAt !== undefined) return 2;
  return 0;
}

export function compareSessions(a: Session, b: Session): number {
  return (
    tierOf(a) - tierOf(b) ||
    (b.endedAt ?? 0) - (a.endedAt ?? 0) ||
    ORDER[a.status] - ORDER[b.status] ||
    b.lastEventAt - a.lastEventAt
  );
}

/**
 * The folders' glyph: `symbol-folder`, which is a CLOSED folder.
 *
 * VSCode treats `folder` and `file` apart: instead of drawing the codicon, it
 * delegates to the file icon theme — and when that theme is "None", it draws
 * NOTHING. Not every fork has this special case: the same machine would show
 * a folder in one editor and nothing in the other.
 *
 * `symbol-folder` points to EXACTLY the same drawing as `folder` (the same
 * code point, U+EA83) under another name — the special case compares the
 * identifier, not the glyph. So this recovers the closed folder, rendered the
 * same way everywhere, and which keeps the folder's colour along the way.
 * `folder-opened`, which escaped the same trap, had the flaw of showing an
 * open folder.
 */
const GROUP_GLYPH = 'symbol-folder';

/**
 * A row's identity, stable from one render to the next.
 *
 * Without `id`, VSCode recognises a row by the OBJECT rendered by
 * `getChildren` — and we build fresh ones every round. Every refresh, even
 * one triggered by a single minute ticking over on a single session, would
 * therefore destroy and rebuild EVERY row: the tooltip one was in the middle
 * of reading would vanish under the mouse. No longer refreshing for nothing
 * (see `refresh`) spaced the symptom out; it is the identity that removes it,
 * because an unchanged row is then not rebuilt at all any more.
 */
export function nodeId(node: TreeNode): string {
  switch (node.kind) {
    case 'group':
      return `group:${node.group?.id ?? 'unfiled'}`;
    case 'session':
      return `session:${node.session.id}`;
    // Scoped by session, and not by pid alone: the system reuses pids, and two
    // rows sharing an identity is how a refresh ends up redrawing the wrong
    // one — the very failure `nodeId` exists to prevent.
    case 'process':
      return `process:${node.sessionId}:${node.proc.pid}`;
    case 'spacer':
      return `spacer:${node.after}`;
    default:
      return 'empty';
  }
}

function isSessionNode(node: TreeNode): node is Extract<TreeNode, { kind: 'session' }> {
  return node.kind === 'session';
}

/**
 * The session id a context menu targets. The same caution as
 * `groupIdOfNode`: VSCode passes the element as-is, so anything at all from
 * the type system's point of view.
 */
export function sessionIdOfNode(node: unknown): string | undefined {
  if (typeof node !== 'object' || node === null) return undefined;
  const candidate = node as { kind?: unknown; session?: { id?: unknown } };
  if (candidate.kind !== 'session' || candidate.session === undefined) return undefined;
  return typeof candidate.session.id === 'string' ? candidate.session.id : undefined;
}

/**
 * The session and the pid a process row stands for, validated field by field
 * like the two above — a context-menu argument arrives as `unknown`, and the
 * pid ends up in a `kill`.
 */
export function processOfNode(node: unknown): { sessionId: string; pid: number } | undefined {
  if (typeof node !== 'object' || node === null) return undefined;
  const candidate = node as { kind?: unknown; sessionId?: unknown; proc?: { pid?: unknown } };
  if (candidate.kind !== 'process' || typeof candidate.sessionId !== 'string') return undefined;
  const pid = candidate.proc?.pid;
  return typeof pid === 'number' && Number.isInteger(pid) && pid > 0 ? { sessionId: candidate.sessionId, pid } : undefined;
}

/**
 * Recovers the id of the folder a context menu targets
 * (kohVibe.renameGroup, kohVibe.deleteGroup): for a `view/item/context`
 * command, VSCode passes the tree element as-is — never a `TreeItem` — so
 * potentially anything at all from the type system's point of view. Validated
 * without a cast, like `handleDrop`: only a NAMED folder node carries an
 * identifier; « Unfiled » (`group: undefined`) is already excluded by the
 * menu's `when` (`viewItem == group`), but guarded against here all the same
 * rather than assumed.
 */
export function groupIdOfNode(node: unknown): string | undefined {
  if (typeof node !== 'object' || node === null) return undefined;
  const candidate = node as { kind?: unknown; group?: { id?: unknown } };
  if (candidate.kind !== 'group' || candidate.group === undefined) return undefined;
  return typeof candidate.group.id === 'string' ? candidate.group.id : undefined;
}

/**
 * Inserts an empty row between the folders — never before the first, which
 * would have nothing to separate, nor after the last, which would leave a
 * blank at the bottom of the view. Each separator carries the identifier of
 * the folder it precedes: VSCode distinguishes tree elements by their
 * identity, and two indistinguishable separators would step on each other on
 * refresh.
 */
function withSpacers(nodes: readonly TreeNode[]): TreeNode[] {
  const out: TreeNode[] = [];
  for (const node of nodes) {
    if (out.length > 0 && node.kind === 'group') {
      out.push({ kind: 'spacer', after: node.group?.id ?? 'unfiled' });
    }
    out.push(node);
  }
  return out;
}

/**
 * The string ids carried by a transferred item. `value` is never cast: it
 * travels as `unknown` and is only accepted once its shape has been checked,
 * because what a drop hands us may come from another tree, or from the OS.
 */
function idsOf(item: vscode.DataTransferItem | undefined): string[] {
  if (item === undefined) return [];
  const value: unknown = item.value;
  if (!Array.isArray(value)) return [];
  return value.filter((id): id is string => typeof id === 'string');
}

export class SessionsTree implements vscode.TreeDataProvider<TreeNode>, vscode.TreeDragAndDropController<TreeNode> {
  // A MIME type of our own: it is what distinguishes a drop coming from this
  // tree (whose content format is known) from a drop coming from elsewhere
  // (another tree, the OS) — see handleDrop.
  private static readonly MIME = 'application/vnd.code.tree.kohvibe.sessions';
  // Folders travel under a type of their own rather than sharing the sessions'
  // with a tag inside. A mixed selection then simply carries both, and
  // handleDrop picks the one that matches what it was dropped on — instead of
  // having to arbitrate between two kinds inside one payload.
  private static readonly GROUP_MIME = 'application/vnd.code.tree.kohvibe.groups';
  readonly dropMimeTypes = [SessionsTree.MIME, SessionsTree.GROUP_MIME];
  readonly dragMimeTypes = [SessionsTree.MIME, SessionsTree.GROUP_MIME];

  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.emitter.event;
  private sessions: Session[] = [];
  private groups: GroupsState = emptyGroups();
  // `undefined` = nothing has been shown yet: the first render always goes through.
  private rendered: string | undefined;
  // The freshest hooks-installed state the render loop has observed, fed by
  // `setHooksInstalled`. `undefined` = never observed yet: `getChildren` then
  // falls back to asking `checkHooksInstalled` itself, so the first empty
  // display never waits for a render tick.
  private hooksInstalled: boolean | undefined;
  // The ended rows a click is bringing back (ui/reopening.ts): a spinner in
  // place of the dot, and no command until they show up or give up.
  private reopening: ReadonlySet<string> = new Set();
  // The colour a folder shows while its picker is open (ui/colors.ts). A
  // per-window overlay over `groups`, cleared when the picker closes: nothing
  // here is ever written to the shared file.
  private preview: ColorPreview | undefined;
  // Whether the dots turn, from the shared settings. `true` until the first
  // read says otherwise — the moving set is what ships, and a first frame of
  // still dots would flicker for nothing on every window that keeps them.
  private animate = true;
  // What each live session is running, from the process table (process/*).
  // Empty until the first scan, and empty again whenever the view is hidden:
  // an invisible tree is not worth a `ps` every two seconds.
  private processes: ReadonlyMap<string, SessionProcess[]> = new Map();

  constructor(
    // Receives the check rather than owning it: reading settings.json every
    // REFRESH_MS for a rare case (no session at all) would cost permanently.
    // Consulted only when this empty node is about to be shown (I5) — never
    // cached beyond a single call, so that an installation made in the
    // meantime is seen without reloading the window.
    private readonly checkHooksInstalled: () => Promise<boolean>,
    // Signals an intent, like checkHooksInstalled above: the view knows
    // neither the filing file nor updateGroups. The wiring supplies a
    // function that calls updateGroups. Mandatory and with no default value:
    // wiring that was forgotten must fail at compile time, not produce a
    // drag-and-drop that is silently inert at runtime.
    private readonly onDrop: (
      sessionIds: readonly string[],
      groupId: string | undefined,
      order: readonly string[],
    ) => Promise<void>,
    // Same contract as onDrop, for the folders themselves: the view says where
    // they should go, the wiring writes it. `beforeId === undefined` means the
    // end of the list.
    private readonly onGroupsDropped: (
      groupIds: readonly string[],
      beforeId: string | undefined,
    ) => Promise<void>,
    // The root of the installed package, from which the status dots are
    // read. Mandatory, like onDrop: a view wired without it would show rows
    // with no icon at all, and the status is not readable anywhere else in
    // the row. Better that it does not compile.
    private readonly extensionPath: string,
  ) {}

  setSessions(map: Map<string, Session>): void {
    this.sessions = [...map.values()].sort(compareSessions);
    this.refresh();
  }

  /**
   * The processes each session is running, fed by the render loop — the view
   * scans nothing itself, same contract as `setGroups` and for the same
   * reason: it stays testable without a process table.
   */
  setProcesses(processes: ReadonlyMap<string, SessionProcess[]>): void {
    this.processes = processes;
    this.refresh();
  }

  // The view displays the filing, it does not go fetch it: the same
  // principle as checkHooksInstalled above, for the same testability reason.
  setGroups(state: GroupsState): void {
    this.groups = state;
    this.refresh();
  }

  /**
   * Fed by the render loop, and only while there is no session to show (the
   * only time the value is consulted — I5). Without it, the "hooks not
   * installed" row could never notice an installation made while the window
   * was open: the signature below did not change, so nothing ever fired
   * `onDidChangeTreeData`, so VSCode never called `getChildren` again — the
   * very symptom the injected checker was meant to avoid. Taking part in the
   * signature is what turns an observed change into a redraw.
   */
  setHooksInstalled(installed: boolean): void {
    this.hooksInstalled = installed;
    this.refresh();
  }

  /** Fed by the render loop, from the shared settings file. */
  setAnimate(on: boolean): void {
    this.animate = on;
    this.refresh();
  }

  /** Fed by the `Reopening` set's own notification, never computed here. */
  setReopening(ids: ReadonlySet<string>): void {
    this.reopening = ids;
    this.refresh();
  }

  /**
   * Shows a colour on one folder without writing it anywhere — what the colour
   * picker calls as the highlighted entry moves.
   *
   * `color: undefined` previews "None", which is why it is passed rather than
   * inferred: removing a colour has to be as visible before confirming as
   * setting one. Only `clearPreview` ends the preview.
   */
  setPreview(groupId: string, color: string | undefined): void {
    this.preview = { groupId, color };
    this.refresh();
  }

  /** Back to what the folders actually hold — the picker closed, either way. */
  clearPreview(): void {
    if (this.preview === undefined) return;
    this.preview = undefined;
    this.refresh();
  }

  /**
   * What the view ACTUALLY displays, in comparable form.
   *
   * Not the raw state: `lastEventAt` changes on every event, but the age
   * shown only moves as a minute passes. Comparing what is rendered, and not
   * what produces it, is what makes the comparison useful.
   */
  private signature(): string {
    const now = Date.now();
    return JSON.stringify([
      // Only relevant when the session list is empty — the sole case where the
      // hooks row is displayed. Included unconditionally: it is inert
      // otherwise, and a conditional here would be one more branch to keep in
      // step with getChildren.
      this.hooksInstalled ?? null,
      this.sessions.map((s) => [
        s.id,
        s.status,
        isOpen(s),
        sessionLabel(s),
        sessionDescription(s, now),
        groupIdOf(this.groups, s.id),
        this.reopening.has(s.id),
        // What the rows under this session DISPLAY, never the raw scan: the
        // pid, the label and the coarse age, and nothing that moves on its
        // own. `elapsed` counts seconds, so putting it here would change the
        // signature on every tick and rebuild the whole tree twice a second —
        // the exact behaviour this comparison exists to avoid.
        (this.processes.get(s.id) ?? []).map((p) => [p.pid, p.ppid, p.label, processDescription(p), glyphOf(p)]),
      ]),
      this.groups.groups,
      this.groups.sessionOrder,
      // Without this, a preview changed nothing VSCode could see: `refresh`
      // compares what is DISPLAYED, and the displayed colour of a folder is no
      // longer `groups` alone.
      this.preview ?? null,
      // Same reason: it decides which file every dot points at.
      this.animate,
    ]);
  }

  /**
   * Only tells VSCode when the display has changed.
   *
   * The render runs every REFRESH_MS and calls four setters: signalling every
   * time made the tree get rebuilt twice a second, which whisked the tooltip
   * away from under the mouse before one had finished reading it. A tree that
   * has not changed has nothing to announce.
   */
  private refresh(): void {
    const next = this.signature();
    if (next === this.rendered) return;
    this.rendered = next;
    this.emitter.fire();
  }

  /**
   * Applies the hand-chosen order BLOCK BY BLOCK: first the awake
   * conversations, then the ones that are asleep. Within each block, the
   * sessions the order names come first, in that order; the ones it ignores
   * follow, in the dashboard's own sort — a session opened after a manual
   * arrangement therefore settles at the end without disturbing what was
   * placed.
   *
   * The split into two blocks comes BEFORE the manual order, and it is the
   * one point that does not negotiate. Without it, a hand-arranged folder
   * ranked its named sessions first without looking at `endedAt`: putting one
   * of them to sleep greyed it in place without ever moving it, and a live
   * conversation could end up below the separator row. What the chosen order
   * decides is a session's place AMONG ITS OWN KIND; sleep decides, for its
   * part, which side of the cut it falls on.
   *
   * `sessions` arrives already sorted (setSessions): the remaining ones keep
   * that order, and filtering by block preserves it.
   */
  private ordered(sessions: readonly Session[], groupId: string | undefined): Session[] {
    const awake = sessions.filter((s) => s.endedAt === undefined);
    const asleep = sessions.filter((s) => s.endedAt !== undefined);
    const wanted = sessionOrderOf(this.groups, groupId);
    if (wanted.length === 0) return [...awake, ...asleep];
    const rank = new Map(wanted.map((id, i) => [id, i]));
    const arrange = (block: readonly Session[]): Session[] => {
      const placed = block
        .filter((s) => rank.has(s.id))
        .map((s) => ({ s, at: rank.get(s.id) ?? 0 }))
        .sort((a, b) => a.at - b.at)
        .map((x) => x.s);
      return [...placed, ...block.filter((s) => !rank.has(s.id))];
    };
    return [...arrange(awake), ...arrange(asleep)];
  }

  /**
   * The folder where a session actually shows up. An assignment that names a
   * deleted folder does not count: the session is then « Unfiled », exactly
   * as in getChildren — the two must never diverge.
   */
  private groupOfSession(sessionId: string): string | undefined {
    const id = groupIdOf(this.groups, sessionId);
    return id !== undefined && this.groups.groups.some((g) => g.id === id) ? id : undefined;
  }

  /** A folder's visible order, as it is displayed at this instant. */
  private visibleOrder(groupId: string | undefined): string[] {
    const sessions = this.sessions.filter((s) => this.groupOfSession(s.id) === groupId);
    return this.ordered(sessions, groupId).map((s) => s.id);
  }

  /**
   * A row's parent, required by `TreeView.reveal`: VSCode climbs back up to
   * the root to unfold whatever is needed before selecting.
   *
   * The folder is rebuilt with ITS sessions, not rendered as an empty shell:
   * VSCode can ask again for the children of the parent it is given, and a
   * folder with no content would fold the view back instead of opening it.
   * The filtering and the sorting are exactly those of `getChildren` — the
   * two must never diverge.
   */
  getParent(node: TreeNode): TreeNode | undefined {
    if (node.kind !== 'session') return undefined;
    const id = this.groupOfSession(node.session.id);
    const group = id === undefined ? undefined : this.groups.groups.find((g) => g.id === id);
    const sessions = this.ordered(
      this.sessions.filter((s) => this.groupOfSession(s.id) === id),
      id,
    );
    return { kind: 'group', group, sessions };
  }

  /**
   * A conversation's row, named by its identifier. Whatever calls — the
   * active tab, on the editor's side — knows a session, not the shape of
   * this tree's nodes, and does not have to learn it.
   */
  nodeFor(sessionId: string): TreeNode | undefined {
    const session = this.sessions.find((s) => s.id === sessionId);
    return session === undefined ? undefined : { kind: 'session', session };
  }

  async getChildren(node?: TreeNode): Promise<TreeNode[]> {
    if (node === undefined) {
      if (this.sessions.length === 0) {
        const installed = this.hooksInstalled ?? (await this.checkHooksInstalled());
        return [
          installed
            ? { kind: 'empty', message: vscode.l10n.t('No active Claude Code session') }
            : { kind: 'empty', message: vscode.l10n.t('Hooks not installed — click to install them'), action: 'install' },
        ];
      }
      const knownIds = new Set(this.groups.groups.map((g) => g.id));
      const byGroup = new Map<string, Session[]>();
      const unfiled: Session[] = [];
      for (const s of this.sessions) {
        const groupId = groupIdOf(this.groups, s.id);
        if (groupId !== undefined && knownIds.has(groupId)) {
          const list = byGroup.get(groupId) ?? [];
          list.push(s);
          byGroup.set(groupId, list);
        } else {
          unfiled.push(s);
        }
      }
      // Every folder shows up, even an empty one — it is a drop target;
      // « Unfiled » only if it has content, otherwise this leftover has
      // nothing to show, and always comes last.
      const nodes: TreeNode[] = this.groups.groups.map((group) => ({
        kind: 'group',
        group,
        sessions: this.ordered(byGroup.get(group.id) ?? [], group.id),
      }));
      if (unfiled.length > 0) {
        nodes.push({ kind: 'group', group: undefined, sessions: this.ordered(unfiled, undefined) });
      }
      return withSpacers(nodes);
    }
    if (node.kind === 'group') {
      // Two blocks within a folder: what is awake, then what is asleep.
      // `compareSessions` has already arranged them in that order; all that
      // was missing was the breathing room between the two, without which a
      // greyed conversation reads as the continuation of the live list. The
      // separator carries the folder's id: VSCode distinguishes rows by their
      // identity, and two identical separators would step on each other on
      // refresh — the same reason as in `withSpacers`.
      const rows: TreeNode[] = [];
      let awake = false;
      let broken = false;
      for (const session of node.sessions) {
        if (session.endedAt === undefined) awake = true;
        // The cut marks the TRANSITION from awake to asleep, not the mere
        // presence of a row above it: a folder entirely asleep has no
        // boundary to show.
        else if (!broken && awake) {
          rows.push({ kind: 'spacer', after: `asleep:${node.group?.id ?? 'unfiled'}` });
          broken = true;
        }
        rows.push({ kind: 'session', session });
      }
      return rows;
    }
    // A session unfolds into what it started, and each of those into what IT
    // started: the shape of the process tree is kept rather than flattened,
    // because that shape is the answer to "who launched this".
    if (node.kind === 'session') {
      const procs = this.processes.get(node.session.id) ?? [];
      return rootsOf(procs).map((proc) => ({ kind: 'process', sessionId: node.session.id, proc }));
    }
    if (node.kind === 'process') {
      const procs = this.processes.get(node.sessionId) ?? [];
      return childrenOf(procs, node.proc.pid).map((proc) => ({ kind: 'process', sessionId: node.sessionId, proc }));
    }
    return [];
  }

  getTreeItem(node: TreeNode): vscode.TreeItem {
    if (node.kind === 'empty') {
      const item = new vscode.TreeItem(node.message);
      item.id = 'empty';
      if (node.action === 'install') {
        item.command = { command: 'kohVibe.installHooks', title: vscode.l10n.t('Install') };
      }
      return item;
    }
    if (node.kind === 'spacer') {
      // An empty label, and nothing else: no icon (which would make it
      // visible), no command (which would make it clickable), no
      // contextValue (which would give it a menu). It is only here to
      // occupy the height of a row.
      const item = new vscode.TreeItem('');
      item.id = nodeId(node);
      return item;
    }
    if (node.kind === 'group') {
      const item = new vscode.TreeItem(node.group?.name ?? vscode.l10n.t('Temporary sessions'), vscode.TreeItemCollapsibleState.Expanded);
      item.id = nodeId(node);
      if (node.group === undefined) {
        item.tooltip = vscode.l10n.t(
          'Conversations not filed in a folder. Drag one into a folder to keep it: left here, it leaves the list after 24 hours without activity (see the settings).',
        );
      }
      item.description =
        node.sessions.length > 1
          ? vscode.l10n.t('{0} sessions', node.sessions.length)
          : vscode.l10n.t('{0} session', node.sessions.length);
      // « Unfiled » is not a folder: it does not take a colour, for lack of
      // being able to carry a user's choice.
      const theme = themeColorOf(shownColor(node.group, this.preview));
      item.iconPath = new vscode.ThemeIcon(GROUP_GLYPH, theme === undefined ? undefined : new vscode.ThemeColor(theme));
      // The label follows the icon: it is the decoration provider that
      // colours it, the only way VSCode offers to reach a row's text.
      if (theme !== undefined && node.group !== undefined) {
        item.resourceUri = vscode.Uri.from(decorationUriParts('group', node.group.id, theme));
      }
      // « Unfiled » is not a folder of the user's own: no id, no renaming or
      // deleting possible, hence not this contextValue.
      item.contextValue = node.group === undefined ? 'unfiled' : 'group';
      return item;
    }
    if (node.kind === 'process') {
      return processItem(node.proc, nodeId(node), hasChildren(this.processes.get(node.sessionId) ?? [], node.proc.pid));
    }
    const s = node.session;
    const now = Date.now();
    const procs = this.processes.get(s.id) ?? [];
    // Collapsed, never expanded: what a session runs is detail on demand. An
    // expanded default would push the conversations below it off the screen,
    // and the list of conversations is what this view is for.
    //
    // The arrow follows `rootsOf`, not the whole list: a session running only
    // its MCP servers has nothing to unfold here — those live in the Processes
    // view now — and an arrow opening onto an empty list is a broken promise.
    const item = new vscode.TreeItem(
      sessionLabel(s),
      rootsOf(procs).length === 0 ? vscode.TreeItemCollapsibleState.None : vscode.TreeItemCollapsibleState.Collapsed,
    );
    item.id = nodeId(node);
    const running = processCount(procs);
    item.description =
      running === 0 ? sessionDescription(s, now) : `${sessionDescription(s, now)} · ${vscode.l10n.t('{0} running', running)}`;
    item.tooltip = sessionTooltip(s, now);
    // Three values, because three rows do not offer the same gestures. The
    // moon closes a tab: it only makes sense on a live conversation THAT
    // CAME FROM AN EDITOR — `closePlan` (close/plan.ts) only recognises a tab
    // for `vscode`. A greyed row has no tab any more, a terminal conversation
    // never had one: neither must show a button that would do nothing. The
    // shared prefix lets the shared menus — sounds, remove, trash, copy the
    // ID — target all three with a single `=~`.
    item.contextValue =
      s.endedAt !== undefined ? 'sessionAsleep' : s.origin === 'vscode' ? 'session' : 'sessionNoTab';
    item.accessibilityInformation = { label: `${sessionLabel(s)}, ${statusLabel(s.status)}` };
    // `TreeItem.iconPath` accepts ONLY Uris in this form — not paths. The
    // conversion stays here so that statusIconPath() does not need VSCode's
    // API, and can therefore be tested without it.
    // A muted dot for what is not open — ended, or a tab nobody has woken —
    // and the label greyed with it, through the same decoration provider the
    // folders use: the only way VSCode offers to colour a row's text.
    // Only an ENDED row is muted: a restored tab is open, and reads as idle.
    const pastille = statusIconPath(this.extensionPath, s.endedAt === undefined ? s.status : 'ended', this.animate);
    item.iconPath = { light: vscode.Uri.file(pastille.light), dark: vscode.Uri.file(pastille.dark) };
    if (s.endedAt !== undefined) item.resourceUri = vscode.Uri.from(decorationUriParts('session', s.id, 'disabledForeground'));
    if (this.reopening.has(s.id)) {
      // Same as the closed view: between the click and the conversation
      // showing up, the row is what says something is happening — and takes
      // no second click, which started a second reopen and a second tab.
      item.iconPath = new vscode.ThemeIcon('loading~spin');
      item.description = vscode.l10n.t('reopening…');
      return item;
    }
    // Deliberately NO colour on an open session: the folder's tint brought
    // down onto its conversations drowned the reading. The folder carries
    // the colour, its sessions carry their status.
    item.command = { command: 'kohVibe.focusSession', title: vscode.l10n.t('Go to session'), arguments: [s] };
    return item;
  }

  // What the user picks up in the drag: only the selected sessions, never a
  // folder — a folder makes no sense being dropped elsewhere in this tree.
  handleDrag(source: readonly TreeNode[], data: vscode.DataTransfer): void {
    const ids = source.filter(isSessionNode).map((node) => node.session.id);
    if (ids.length > 0) data.set(SessionsTree.MIME, new vscode.DataTransferItem(ids));
    // Named folders only: « Unfiled » has no id, so there is nothing to move
    // and nowhere to record it — it stays last, where getChildren puts it.
    const groupIds = source
      .filter((node): node is Extract<TreeNode, { kind: 'group' }> => node.kind === 'group')
      .map((node) => node.group?.id)
      .filter((id): id is string => id !== undefined);
    if (groupIds.length > 0) data.set(SessionsTree.GROUP_MIME, new vscode.DataTransferItem(groupIds));
  }

  // Targeting does not go through contextValue: `target` is the VSCode node
  // under the cursor. Only a folder node (named or « Unfiled ») is a valid
  // target — the empty view (target undefined) or any other row changes
  // nothing. `item.value` is never cast: it travels through `unknown` and is
  // only accepted after explicit validation of its shape.
  async handleDrop(target: TreeNode | undefined, data: vscode.DataTransfer): Promise<void> {
    // Two valid targets, and only two: a folder (it is filed there, at the
    // end) or a session (it is placed in front of it, in ITS folder). The
    // empty view, a separator or the empty-state node change nothing.
    if (target === undefined) return;
    if (target.kind !== 'group' && target.kind !== 'session') return;
    // Folders first: a drag that carries both kinds is resolved by what it was
    // dropped ON, and a folder dropped onto a folder can only mean a move.
    // Folders only claim the drop when it landed on a folder. Dropped on a
    // session, the gesture names no position among the folders — and refusing
    // the whole drop there would also swallow the sessions of a mixed drag,
    // which do have a meaning on that target.
    const groupIds = idsOf(data.get(SessionsTree.GROUP_MIME));
    if (groupIds.length > 0 && target.kind === 'group') {
      await this.onGroupsDropped(groupIds, target.group?.id);
      return;
    }
    const item = data.get(SessionsTree.MIME);
    if (item === undefined) return;
    const sessionIds = idsOf(item);
    if (sessionIds.length === 0) return;

    const groupId = target.kind === 'group' ? target.group?.id : this.groupOfSession(target.session.id);
    const before = target.kind === 'session' ? target.session.id : undefined;
    // The order passed on is the folder's AFTER the drop, computed on what
    // is displayed right now. Freezing it entirely is the point: a session
    // placed by hand must no longer move when its status changes.
    await this.onDrop(sessionIds, groupId, reorder(this.visibleOrder(groupId), sessionIds, before));
  }

  dispose(): void {
    this.emitter.dispose();
  }
}
