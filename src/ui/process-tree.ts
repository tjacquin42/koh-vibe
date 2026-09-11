import * as vscode from 'vscode';
import type { Session } from '../events/types';
import type { SessionProcess } from '../process/classify';
import type { Orphan } from '../process/orphans';
import { childrenOf, glyphOf, mcpOf, processDescription, processTooltip } from './process-labels';
import { formatAge, formatAgeCoarse, sessionLabel } from './labels';

/**
 * A row of the Processes view: what runs on the machine that no single
 * conversation accounts for.
 *
 * Two kinds of thing end up here, and they are here for opposite reasons. MCP
 * servers belong to a session — firmly, one set per conversation — but they are
 * identical from one to the next, so repeating them under every session buried
 * the work that actually differs. Orphans belong to nothing at all: a process
 * whose parent died is adopted by the process 1, which takes it out of every
 * session's subtree and out of the sessions view for good.
 */
export type ProcessNode =
  | { kind: 'section'; section: 'mcp' | 'orphans'; count: number }
  // Deliberately the same shape as the sessions view's process node, so
  // `processOfNode` reads both and one context menu serves the two views.
  | { kind: 'process'; sessionId: string; proc: SessionProcess }
  | { kind: 'orphan'; orphan: Orphan }
  // What an orphan hides. Carries its subtree rather than a session id: no
  // session holds this process, so there is no list to look it up in later.
  | { kind: 'orphanChild'; proc: SessionProcess; tree: SessionProcess[] }
  | { kind: 'empty' };

export function processNodeId(node: ProcessNode): string {
  switch (node.kind) {
    case 'section':
      return `section:${node.section}`;
    case 'process':
      return `process:${node.sessionId}:${node.proc.pid}`;
    case 'orphan':
      return `orphan:${node.orphan.root.pid}`;
    case 'orphanChild':
      return `orphan:${node.proc.pid}`;
    default:
      return 'empty';
  }
}

/**
 * The pid an orphan row stands for. Validated like its siblings: a
 * context-menu argument arrives as `unknown`, and this pid ends up in a
 * `kill`.
 */
export function orphanOfNode(node: unknown): number | undefined {
  if (typeof node !== 'object' || node === null) return undefined;
  const candidate = node as { kind?: unknown; orphan?: { root?: { pid?: unknown } }; proc?: { pid?: unknown } };
  // Both row kinds of the section answer here: a menu acts on the row it was
  // opened over, and a child of an orphan is as killable as its root.
  const pid = candidate.kind === 'orphan' ? candidate.orphan?.root?.pid : candidate.kind === 'orphanChild' ? candidate.proc?.pid : undefined;
  return typeof pid === 'number' && Number.isInteger(pid) && pid > 0 ? pid : undefined;
}

/**
 * The Processes view, between the conversations and the usage.
 *
 * Owns no scan of its own: the render loop feeds it, exactly as it feeds the
 * sessions tree, so it stays testable without a process table.
 */
export class ProcessesTree implements vscode.TreeDataProvider<ProcessNode> {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.emitter.event;
  private processes: ReadonlyMap<string, SessionProcess[]> = new Map();
  private sessions: ReadonlyMap<string, Session> = new Map();
  private orphans: readonly Orphan[] = [];
  // `undefined` = nothing rendered yet, so the first pass always goes through.
  private rendered: string | undefined;

  setProcesses(processes: ReadonlyMap<string, SessionProcess[]>, sessions: ReadonlyMap<string, Session>): void {
    this.processes = processes;
    this.sessions = sessions;
    this.refresh();
  }

  setOrphans(orphans: readonly Orphan[]): void {
    this.orphans = orphans;
    this.refresh();
  }

  /** The servers of every session, in one list, each tied to its own. */
  private servers(): { sessionId: string; proc: SessionProcess }[] {
    const out: { sessionId: string; proc: SessionProcess }[] = [];
    for (const [sessionId, procs] of this.processes) {
      for (const proc of mcpOf(procs)) out.push({ sessionId, proc });
    }
    return out;
  }

  async getChildren(node?: ProcessNode): Promise<ProcessNode[]> {
    if (node === undefined) {
      const servers = this.servers().filter((s) => s.proc.depth === 0);
      const sections: ProcessNode[] = [];
      if (servers.length > 0) sections.push({ kind: 'section', section: 'mcp', count: servers.length });
      if (this.orphans.length > 0) sections.push({ kind: 'section', section: 'orphans', count: this.orphans.length });
      // A section is shown only when it holds something: an empty « No session »
      // is the normal state of a healthy machine, and a permanent empty heading
      // is a heading nobody reads any more.
      return sections.length === 0 ? [{ kind: 'empty' }] : sections;
    }
    if (node.kind === 'section') {
      if (node.section === 'orphans') return this.orphans.map((orphan) => ({ kind: 'orphan', orphan }));
      // Only the servers themselves at this level. What a server started sits
      // under it, one unfold away, which is where its real memory shows.
      return this.servers()
        .filter((s) => s.proc.depth === 0)
        .map(({ sessionId, proc }) => ({ kind: 'process', sessionId, proc }));
    }
    if (node.kind === 'process') {
      const procs = this.processes.get(node.sessionId) ?? [];
      return childrenOf(procs, node.proc.pid).map((proc) => ({ kind: 'process', sessionId: node.sessionId, proc }));
    }
    if (node.kind === 'orphan') {
      const { tree, root } = node.orphan;
      return childrenOf(tree, root.pid).map((proc) => ({ kind: 'orphanChild', proc, tree }));
    }
    if (node.kind === 'orphanChild') {
      return childrenOf(node.tree, node.proc.pid).map((proc) => ({ kind: 'orphanChild', proc, tree: node.tree }));
    }
    return [];
  }

  getTreeItem(node: ProcessNode): vscode.TreeItem {
    if (node.kind === 'empty') {
      const item = new vscode.TreeItem(vscode.l10n.t('Nothing is running'));
      item.id = processNodeId(node);
      return item;
    }
    if (node.kind === 'section') {
      const item = new vscode.TreeItem(
        node.section === 'mcp' ? vscode.l10n.t('MCP servers') : vscode.l10n.t('No session'),
        vscode.TreeItemCollapsibleState.Expanded,
      );
      item.id = processNodeId(node);
      item.description =
        node.section === 'mcp'
          ? node.count > 1
            ? vscode.l10n.t('{0} servers', node.count)
            : vscode.l10n.t('{0} server', node.count)
          : node.count > 1
            ? vscode.l10n.t('{0} processes', node.count)
            : vscode.l10n.t('{0} process', node.count);
      if (node.section === 'orphans') {
        item.tooltip = vscode.l10n.t(
          'Processes no conversation carries any more: their session is gone, and the system reparented them. A forgotten development server still holding its port is the usual case.',
        );
      }
      return item;
    }
    if (node.kind === 'orphan') {
      const { root, tree, cwd } = node.orphan;
      // Unfoldable whenever it hides something, which is the usual case: what
      // was adopted is often a shell, and the server holding the port is under
      // it — see process/orphans.
      const item = new vscode.TreeItem(
        root.label,
        tree.length > 1 ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
      );
      item.id = processNodeId(node);
      // The directory is what makes a lost process recognisable — it is the
      // only thing left saying which project it came from.
      item.description = `${projectOfPath(cwd)} · ${formatAgeCoarse(root.elapsed * 1000)}`;
      item.tooltip = [
        root.command,
        cwd,
        `${vscode.l10n.t('no session')} · ${vscode.l10n.t('pid {0}', root.pid)} · ${formatAge(root.elapsed * 1000)}`,
        vscode.l10n.t('{0} MB of memory', Math.round(root.rss / 1024)),
      ].join('\n');
      item.iconPath = new vscode.ThemeIcon('question');
      item.contextValue = 'orphan';
      item.accessibilityInformation = { label: `${root.label}, ${vscode.l10n.t('no session')}` };
      return item;
    }
    if (node.kind === 'orphanChild') {
      const { proc, tree } = node;
      const hasChildren = tree.some((p) => p.ppid === proc.pid);
      const item = new vscode.TreeItem(
        proc.label,
        hasChildren ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
      );
      item.id = processNodeId(node);
      item.description = processDescription(proc);
      item.tooltip = processTooltip(proc);
      item.iconPath = new vscode.ThemeIcon(glyphOf(proc));
      item.contextValue = 'orphan';
      item.accessibilityInformation = { label: `${proc.label}, ${processDescription(proc)}` };
      return item;
    }
    const { proc } = node;
    const hasChildren = childrenOf(this.processes.get(node.sessionId) ?? [], proc.pid).length > 0;
    const item = new vscode.TreeItem(
      proc.label,
      hasChildren ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
    );
    item.id = processNodeId(node);
    const session = this.sessions.get(node.sessionId);
    // The conversation, not the age alone: in this view the rows of every
    // session sit side by side, and which one a server belongs to is the
    // question the view exists to answer.
    const whose = session === undefined ? vscode.l10n.t('unknown conversation') : sessionLabel(session);
    item.description = `${whose} · ${processDescription(proc)}`;
    item.tooltip = processTooltip(proc);
    item.iconPath = new vscode.ThemeIcon(glyphOf(proc));
    item.contextValue = proc.kind === 'mcp' ? 'processMcp' : 'process';
    item.accessibilityInformation = { label: `${proc.label}, ${whose}` };
    return item;
  }

  /**
   * Same contract as the sessions tree: only tell VSCode when what is
   * DISPLAYED changed. The ages here are coarse for that reason, and the raw
   * `elapsed` never takes part.
   */
  private signature(): string {
    return JSON.stringify([
      this.servers().map(({ sessionId, proc }) => [
        sessionId,
        proc.pid,
        proc.ppid,
        proc.label,
        processDescription(proc),
        glyphOf(proc),
        this.sessions.get(sessionId)?.title ?? null,
      ]),
      this.orphans.map((o) => [
        o.root.pid,
        o.root.label,
        projectOfPath(o.cwd),
        formatAgeCoarse(o.root.elapsed * 1000),
        o.tree.map((p) => [p.pid, p.label, processDescription(p)]),
      ]),
    ]);
  }

  private refresh(): void {
    const next = this.signature();
    if (next === this.rendered) return;
    this.rendered = next;
    this.emitter.fire();
  }
}

/**
 * The last meaningful segment of a path, for the right-hand side of a row.
 *
 * Not `events/origin.ts`'s `projectOf`: that one climbs out of a worktree to
 * name the project, which is right for a conversation. Here the point is to say
 * where the process actually works, worktree included — that is the directory
 * whose port is held.
 */
function projectOfPath(cwd: string): string {
  const parts = cwd.split('/').filter((p) => p.length > 0);
  return parts[parts.length - 1] ?? cwd;
}
