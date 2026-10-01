import * as vscode from 'vscode';
import type { FeedView } from '../cloud/feed';
import type { Routine } from '../routines/model';
import { sectionsOf, type RoutineGroup } from '../routines/schedule';
import { loadingItem, retryItem, unavailableTooltip } from './feed-labels';
import { groupLabel, routineDescription, routineTooltip } from './routine-labels';

/** A row of the Routines view: a date group, a routine, or the line standing in for a list. */
export type RoutineNode =
  | { kind: 'section'; group: RoutineGroup; count: number }
  | { kind: 'routine'; routine: Routine; group: RoutineGroup }
  | { kind: 'loading' }
  | { kind: 'signed-out' }
  | { kind: 'unavailable' }
  | { kind: 'empty' };

export function routineNodeId(node: RoutineNode): string {
  switch (node.kind) {
    case 'section':
      return `routines:${node.group}`;
    case 'routine':
      return `routine:${node.routine.id}`;
    default:
      return `routines:${node.kind}`;
  }
}

/**
 * The routine a row stands for — from a click, which passes the row itself, or
 * from a context menu. Validated like every node VSCode hands back: it is
 * anything at all as far as the types are concerned.
 */
export function routineIdOfNode(node: unknown): string | undefined {
  if (typeof node !== 'object' || node === null) return undefined;
  const candidate = node as { kind?: unknown; routine?: { id?: unknown } };
  if (candidate.kind !== 'routine' || candidate.routine === undefined) return undefined;
  return typeof candidate.routine.id === 'string' ? candidate.routine.id : undefined;
}

/** What package.json reads to choose the row's buttons. */
export function routineContext(r: Routine): 'routine.enabled' | 'routine.paused' | 'routine.fired' {
  if (r.fired) return 'routine.fired';
  return r.enabled ? 'routine.enabled' : 'routine.paused';
}

function iconOf(r: Routine): string {
  if (r.fired) return 'check';
  if (!r.enabled) return 'debug-pause';
  return r.cron === undefined ? 'calendar' : 'sync';
}

/**
 * The Routines view. Owns no request of its own: ui/cloud-views.ts feeds it
 * from the shared cache, so it stays testable without a network.
 */
export class RoutinesTree implements vscode.TreeDataProvider<RoutineNode> {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.emitter.event;
  private view: FeedView<Routine> = { kind: 'loading' };
  private now = 0;
  private locale = 'en';
  // `undefined` = nothing drawn yet: the first render always goes through.
  private rendered: string | undefined;

  setFeed(view: FeedView<Routine>, now: number, locale: string): void {
    this.view = view;
    this.now = now;
    this.locale = locale;
    this.refresh();
  }

  /** The routine with this id in the list on screen — what a command acts on, rather than the copy a stale row carried. */
  routine(id: string): Routine | undefined {
    return this.view.kind === 'ready' ? this.view.snapshot.items.find((r) => r.id === id) : undefined;
  }

  getChildren(node?: RoutineNode): RoutineNode[] {
    if (node === undefined) {
      if (this.view.kind === 'loading') return [{ kind: 'loading' }];
      if (this.view.kind === 'signed-out') return [{ kind: 'signed-out' }];
      if (this.view.kind === 'unavailable') return [{ kind: 'unavailable' }];
      const sections = sectionsOf(this.view.snapshot.items, this.now);
      if (sections.length === 0) return [{ kind: 'empty' }];
      return sections.map((s) => ({ kind: 'section', group: s.group, count: s.routines.length }));
    }
    if (node.kind !== 'section' || this.view.kind !== 'ready') return [];
    // Read out of the narrowed node before the callbacks, which do not keep the narrowing.
    const group = node.group;
    const section = sectionsOf(this.view.snapshot.items, this.now).find((s) => s.group === group);
    return (section?.routines ?? []).map((routine) => ({ kind: 'routine', routine, group }));
  }

  getTreeItem(node: RoutineNode): vscode.TreeItem {
    const id = routineNodeId(node);
    switch (node.kind) {
      case 'loading':
        return loadingItem(id);
      case 'signed-out':
        return retryItem(
          id,
          vscode.l10n.t('Not signed in to claude.ai — click to retry'),
          'account',
          vscode.l10n.t(
            'Koh-Vibe reads your routines with the claude.ai account Claude Code is signed in with. Sign in with /login in Claude Code, then click here.',
          ),
          'kohVibe.refreshRoutines',
        );
      case 'unavailable':
        return retryItem(
          id,
          vscode.l10n.t('Could not read your routines — click to retry'),
          'warning',
          unavailableTooltip(),
          'kohVibe.refreshRoutines',
        );
      case 'empty': {
        const item = new vscode.TreeItem(vscode.l10n.t('No routines'));
        item.id = id;
        return item;
      }
      case 'section': {
        // Paused folded away: nothing in it will run on its own.
        const item = new vscode.TreeItem(
          groupLabel(node.group),
          node.group === 'paused' ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.Expanded,
        );
        item.id = id;
        item.description = String(node.count);
        return item;
      }
      case 'routine': {
        const r = node.routine;
        const description = routineDescription(r, node.group, this.now, this.locale);
        const item = new vscode.TreeItem(r.name, vscode.TreeItemCollapsibleState.None);
        item.id = id;
        item.description = description;
        item.tooltip = routineTooltip(r, this.locale);
        item.iconPath = new vscode.ThemeIcon(iconOf(r));
        item.contextValue = routineContext(r);
        item.accessibilityInformation = { label: description === '' ? r.name : `${r.name}, ${description}` };
        item.command = { command: 'kohVibe.openRoutine', title: vscode.l10n.t('Open on claude.ai'), arguments: [node] };
        return item;
      }
    }
  }

  /**
   * Same contract as the other trees: tell VSCode only when what is DISPLAYED
   * changed. The clock moves on every render; a row's text, only now and then.
   */
  private signature(): string {
    if (this.view.kind !== 'ready') return this.view.kind;
    return JSON.stringify(
      sectionsOf(this.view.snapshot.items, this.now).map((s) => [
        s.group,
        s.routines.map((r) => [
          r.id,
          r.name,
          routineDescription(r, s.group, this.now, this.locale),
          routineContext(r),
          iconOf(r),
          routineTooltip(r, this.locale),
        ]),
      ]),
    );
  }

  private refresh(): void {
    const next = this.signature();
    if (next === this.rendered) return;
    this.rendered = next;
    this.emitter.fire();
  }

  dispose(): void {
    this.emitter.dispose();
  }
}
