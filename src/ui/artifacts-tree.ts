import * as vscode from 'vscode';
import { sortArtifacts, type Artifact } from '../artifacts/model';
import type { FeedView } from '../cloud/feed';
import { artifactLabel, artifactTooltip, updatedText } from './artifact-labels';
import { loadingItem, retryItem, unavailableTooltip } from './feed-labels';

/** A row of the Artifacts view: a page, or the line standing in for the list. */
export type ArtifactNode =
  | { kind: 'artifact'; artifact: Artifact }
  | { kind: 'loading' }
  | { kind: 'signed-out' }
  | { kind: 'unavailable' }
  | { kind: 'empty' };

export function artifactNodeId(node: ArtifactNode): string {
  return node.kind === 'artifact' ? `artifact:${node.artifact.slug}` : `artifacts:${node.kind}`;
}

/** The page a row stands for — validated like every node VSCode hands back. */
export function artifactSlugOfNode(node: unknown): string | undefined {
  if (typeof node !== 'object' || node === null) return undefined;
  const candidate = node as { kind?: unknown; artifact?: { slug?: unknown } };
  if (candidate.kind !== 'artifact' || candidate.artifact === undefined) return undefined;
  return typeof candidate.artifact.slug === 'string' ? candidate.artifact.slug : undefined;
}

/** What package.json reads to choose between the pin and the unpin. */
export function artifactContext(a: Artifact): 'artifact.pinned' | 'artifact.unpinned' {
  return a.pinned ? 'artifact.pinned' : 'artifact.unpinned';
}

/** The Artifacts view: a flat list, fed by ui/cloud-views.ts from the shared cache. */
export class ArtifactsTree implements vscode.TreeDataProvider<ArtifactNode> {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.emitter.event;
  private view: FeedView<Artifact> = { kind: 'loading' };
  private now = 0;
  private locale = 'en';
  private rendered: string | undefined;

  setFeed(view: FeedView<Artifact>, now: number, locale: string): void {
    this.view = view;
    this.now = now;
    this.locale = locale;
    this.refresh();
  }

  /** The page with this slug in the list on screen — what a command acts on. */
  artifact(slug: string): Artifact | undefined {
    return this.view.kind === 'ready' ? this.view.snapshot.items.find((a) => a.slug === slug) : undefined;
  }

  getChildren(node?: ArtifactNode): ArtifactNode[] {
    // A flat list: no row has children.
    if (node !== undefined) return [];
    if (this.view.kind === 'loading') return [{ kind: 'loading' }];
    if (this.view.kind === 'signed-out') return [{ kind: 'signed-out' }];
    if (this.view.kind === 'unavailable') return [{ kind: 'unavailable' }];
    const sorted = sortArtifacts(this.view.snapshot.items);
    if (sorted.length === 0) return [{ kind: 'empty' }];
    return sorted.map((artifact) => ({ kind: 'artifact', artifact }));
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

  private signature(): string {
    if (this.view.kind !== 'ready') return this.view.kind;
    return JSON.stringify(
      sortArtifacts(this.view.snapshot.items).map((a) => [
        a.slug,
        artifactLabel(a),
        updatedText(a.updatedAt, this.now, this.locale),
        artifactContext(a),
        artifactTooltip(a, this.locale),
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
