import * as vscode from 'vscode';
import { isSlug, sortArtifacts, type Artifact } from '../artifacts/model';
import {
  emptyArtifactProjects,
  groupByProject,
  projectOfArtifact,
  type ArtifactProjects,
  type ProjectGroup,
} from '../artifacts/projects';
import type { FeedView } from '../cloud/feed';
import { artifactLabel, artifactTooltip, otherLabel, projectTooltip, updatedText } from './artifact-labels';
import { loadingItem, retryItem, unavailableTooltip } from './feed-labels';

/**
 * A row of the Artifacts view: a project's folder (`project` undefined for
 * « Other »), a page, or the line standing in for the list.
 */
export type ArtifactNode =
  | { kind: 'project'; project: string | undefined }
  | { kind: 'artifact'; artifact: Artifact }
  | { kind: 'loading' }
  | { kind: 'signed-out' }
  | { kind: 'unavailable' }
  | { kind: 'empty' };

/** What a drop files: the dragged slugs, into a project or into « Other » (`null`). */
export type FileArtifacts = (slugs: string[], project: string | null) => Promise<void>;

export function artifactNodeId(node: ArtifactNode): string {
  if (node.kind === 'artifact') return `artifact:${node.artifact.slug}`;
  if (node.kind === 'project') return node.project === undefined ? 'artifacts:other' : `artifacts:project:${node.project}`;
  return `artifacts:${node.kind}`;
}

/** The page a row stands for — validated like every node VSCode hands back. */
export function artifactSlugOfNode(node: unknown): string | undefined {
  if (typeof node !== 'object' || node === null) return undefined;
  const candidate = node as { kind?: unknown; artifact?: { slug?: unknown } };
  if (candidate.kind !== 'artifact' || candidate.artifact === undefined) return undefined;
  return typeof candidate.artifact.slug === 'string' ? candidate.artifact.slug : undefined;
}

/**
 * The pages a menu command acts on. VSCode hands it the row clicked and the
 * selection: the whole selection when the row is part of it — moving five
 * pages at once — else the row alone, as in any list.
 */
export function selectedSlugs(node: unknown, nodes: unknown): string[] {
  const clicked = artifactSlugOfNode(node);
  if (clicked === undefined) return [];
  const selected = Array.isArray(nodes) ? nodes.map(artifactSlugOfNode).filter((s): s is string => s !== undefined) : [];
  return selected.includes(clicked) ? selected : [clicked];
}

/** The project a NAMED folder row stands for. « Other » has none: nothing to rename. */
export function projectOfNode(node: unknown): string | undefined {
  if (typeof node !== 'object' || node === null) return undefined;
  const candidate = node as { kind?: unknown; project?: unknown };
  if (candidate.kind !== 'project') return undefined;
  return typeof candidate.project === 'string' ? candidate.project : undefined;
}

/** What package.json reads to choose between the pin and the unpin. */
export function artifactContext(a: Artifact): 'artifact.pinned' | 'artifact.unpinned' {
  return a.pinned ? 'artifact.pinned' : 'artifact.unpinned';
}

/** The slugs a drag carried, or none: the value comes from VSCode untyped, and is checked before use. */
function slugsOf(item: vscode.DataTransferItem | undefined): string[] {
  if (item === undefined) return [];
  const value: unknown = item.value;
  if (!Array.isArray(value)) return [];
  return value.filter(isSlug);
}

/**
 * The Artifacts view: one folder per project, « Other » last, fed by
 * ui/cloud-views.ts from the shared cache and the filing beside it. A flat
 * list while nothing is filed under a project — a lone « Other » folder would
 * only hide the list behind one more click.
 */
export class ArtifactsTree implements vscode.TreeDataProvider<ArtifactNode>, vscode.TreeDragAndDropController<ArtifactNode> {
  // A type of our own: what tells a drag from this view apart from anything
  // else dropped on it — another tree, the OS. See handleDrop.
  private static readonly MIME = 'application/vnd.code.tree.kohvibe.artifacts';
  readonly dragMimeTypes = [ArtifactsTree.MIME];
  readonly dropMimeTypes = [ArtifactsTree.MIME];

  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.emitter.event;
  private view: FeedView<Artifact> = { kind: 'loading' };
  private projects: ArtifactProjects = emptyArtifactProjects();
  private now = 0;
  private locale = 'en';
  private rendered: string | undefined;

  constructor(private readonly onFile: FileArtifacts = async () => undefined) {}

  setFeed(view: FeedView<Artifact>, now: number, locale: string): void {
    this.view = view;
    this.now = now;
    this.locale = locale;
    this.refresh();
  }

  setProjects(projects: ArtifactProjects): void {
    this.projects = projects;
    this.refresh();
  }

  /** The page with this slug in the list on screen — what a command acts on. */
  artifact(slug: string): Artifact | undefined {
    return this.items().find((a) => a.slug === slug);
  }

  /** The slugs a folder shows right now — by its filing or by its title. */
  shownIn(project: string): string[] {
    return this.groups()
      .filter((g) => g.project === project)
      .flatMap((g) => g.artifacts.map((a) => a.slug));
  }

  getChildren(node?: ArtifactNode): ArtifactNode[] {
    if (node !== undefined) {
      if (node.kind !== 'project') return [];
      // Read again from what is on screen now, never from the node VSCode hands
      // back: it may predate the last move.
      const group = this.groups().find((g) => g.project === node.project);
      return (group?.artifacts ?? []).map((artifact) => ({ kind: 'artifact', artifact }));
    }
    if (this.view.kind === 'loading') return [{ kind: 'loading' }];
    if (this.view.kind === 'signed-out') return [{ kind: 'signed-out' }];
    if (this.view.kind === 'unavailable') return [{ kind: 'unavailable' }];
    const groups = this.groups();
    if (groups.length === 0) return [{ kind: 'empty' }];
    if (isFlat(groups)) return sortArtifacts(this.items()).map((artifact) => ({ kind: 'artifact', artifact }));
    return groups.map((g) => ({ kind: 'project', project: g.project }));
  }

  getTreeItem(node: ArtifactNode): vscode.TreeItem {
    const id = artifactNodeId(node);
    switch (node.kind) {
      case 'loading':
        return loadingItem(id);
      case 'signed-out':
        return retryItem(
          id,
          vscode.l10n.t('Not signed in to claude.ai — click to retry'),
          'account',
          vscode.l10n.t(
            'Koh-Vibe reads your artifacts with the claude.ai account Claude Code is signed in with. Sign in with /login in Claude Code, then click here.',
          ),
          'kohVibe.refreshArtifacts',
        );
      case 'unavailable':
        return retryItem(
          id,
          vscode.l10n.t('Could not read your artifacts — click to retry'),
          'warning',
          unavailableTooltip(),
          'kohVibe.refreshArtifacts',
        );
      case 'empty': {
        const item = new vscode.TreeItem(vscode.l10n.t('No artifacts'));
        item.id = id;
        return item;
      }
      case 'project': {
        const count = this.groups().find((g) => g.project === node.project)?.artifacts.length ?? 0;
        const label = node.project ?? otherLabel();
        // Folded: the projects read at a glance, and a folder opened stays
        // open — VSCode keeps that by the row's id.
        const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.Collapsed);
        item.id = id;
        item.description = String(count);
        item.tooltip = projectTooltip(label, count);
        item.iconPath = new vscode.ThemeIcon('folder');
        item.contextValue = node.project === undefined ? 'project.other' : 'project.named';
        item.accessibilityInformation = { label: projectTooltip(label, count) };
        return item;
      }
      case 'artifact': {
        const a = node.artifact;
        const label = artifactLabel(a);
        const description = updatedText(a.updatedAt, this.now, this.locale);
        const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
        item.id = id;
        item.description = description;
        item.tooltip = artifactTooltip(a, this.locale);
        // The pin says what claude.ai's sidebar says; every other page shares one glyph.
        item.iconPath = new vscode.ThemeIcon(a.pinned ? 'pinned' : 'globe');
        item.contextValue = artifactContext(a);
        item.accessibilityInformation = { label: description === '' ? label : `${label}, ${description}` };
        item.command = { command: 'kohVibe.openArtifact', title: vscode.l10n.t('Open on claude.ai'), arguments: [node] };
        return item;
      }
    }
  }

  // Only pages travel: a folder is not something to file anywhere.
  handleDrag(source: readonly ArtifactNode[], data: vscode.DataTransfer): void {
    const slugs = source.flatMap((node) => (node.kind === 'artifact' ? [node.artifact.slug] : []));
    if (slugs.length > 0) data.set(ArtifactsTree.MIME, new vscode.DataTransferItem(slugs));
  }

  // Two targets: a folder — the pages go into it — or a page — they go into
  // ITS folder. The empty view, or a row standing in for the list, files
  // nothing.
  async handleDrop(target: ArtifactNode | undefined, data: vscode.DataTransfer): Promise<void> {
    // No folder in the flat list: a row's folder would be « Other », and filing
    // into it would mark the page « Other » chosen, for good, with nothing on
    // screen to show for it.
    if (target === undefined || isFlat(this.groups())) return;
    let project: string | undefined;
    if (target.kind === 'project') project = target.project;
    else if (target.kind === 'artifact') project = projectOfArtifact(target.artifact, this.projects);
    else return;
    const slugs = slugsOf(data.get(ArtifactsTree.MIME));
    if (slugs.length === 0) return;
    await this.onFile(slugs, project ?? null);
  }

  private items(): readonly Artifact[] {
    return this.view.kind === 'ready' ? this.view.snapshot.items : [];
  }

  private groups(): ProjectGroup[] {
    return groupByProject(this.items(), this.projects);
  }

  private signature(): string {
    if (this.view.kind !== 'ready') return this.view.kind;
    const row = (a: Artifact): unknown[] => [
      a.slug,
      artifactLabel(a),
      updatedText(a.updatedAt, this.now, this.locale),
      artifactContext(a),
      artifactTooltip(a, this.locale),
    ];
    return JSON.stringify(this.groups().map((g) => [g.project ?? null, g.artifacts.map(row)]));
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

/** Nothing under a project: « Other » alone, or nothing at all. */
function isFlat(groups: readonly ProjectGroup[]): boolean {
  return groups.every((g) => g.project === undefined);
}
