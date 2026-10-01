import { describe, expect, it } from 'vitest';
import type { Artifact } from '../src/artifacts/model';
import type { FeedView } from '../src/cloud/feed';
import { updatedText } from '../src/ui/artifact-labels';
import { ArtifactsTree, artifactNodeId, artifactSlugOfNode, type ArtifactNode } from '../src/ui/artifacts-tree';

const at = (y: number, m: number, d: number, h = 12, min = 0): number => new Date(y, m - 1, d, h, min).getTime();
/** Monday 28 September 2026, 10:00 local time. */
const NOW = at(2026, 9, 28, 10, 0);
const norm = (s: string): string => s.replace(/[  ]/g, ' ');

const artifact = (over: Partial<Artifact> = {}): Artifact => ({ slug: 'ArtTest01', title: 'Release notes', pinned: false, ...over });

const ready = (items: Artifact[]): FeedView<Artifact> => ({ kind: 'ready', snapshot: { at: NOW, items, truncated: false } });

const treeOf = (view: FeedView<Artifact>): ArtifactsTree => {
  const tree = new ArtifactsTree();
  tree.setFeed(view, NOW, 'fr');
  return tree;
};

describe('the artifacts view', () => {
  it('shows a loading row, then a row that retries when the read fails', () => {
    expect(new ArtifactsTree().getChildren().map((n) => n.kind)).toEqual(['loading']);
    for (const kind of ['signed-out', 'unavailable'] as const) {
      const tree = treeOf({ kind });
      const [row] = tree.getChildren();
      expect(row?.kind).toBe(kind);
      expect(tree.getTreeItem(row!).command?.command).toBe('kohVibe.refreshArtifacts');
    }
  });

  it('says so when there is no artifact', () => {
    expect(treeOf(ready([])).getChildren().map((n) => n.kind)).toEqual(['empty']);
  });

  it('lists the pinned first, then the most recently updated', () => {
    const tree = treeOf(
      ready([
        artifact({ slug: 'old', updatedAt: at(2026, 8, 30) }),
        artifact({ slug: 'new', updatedAt: at(2026, 9, 27) }),
        artifact({ slug: 'pin', pinned: true, updatedAt: at(2026, 9, 18) }),
      ]),
    );
    expect(tree.getChildren().map(artifactNodeId)).toEqual(['artifact:pin', 'artifact:new', 'artifact:old']);
  });

  it('gives each row its pin button, and opens it on click', () => {
    const tree = treeOf(ready([artifact({ slug: 'a', pinned: true }), artifact({ slug: 'b' })]));
    const rows = tree.getChildren();
    const items = rows.map((r) => tree.getTreeItem(r));
    expect(items.map((i) => i.contextValue)).toEqual(['artifact.pinned', 'artifact.unpinned']);
    expect(items[0]?.iconPath).toMatchObject({ id: 'pinned' });
    expect(items[1]?.iconPath).toMatchObject({ id: 'globe' });
    expect(items[1]?.command).toMatchObject({ command: 'kohVibe.openArtifact', arguments: [rows[1]] });
  });

  it('names an untitled page so, rather than drawing a blank row', () => {
    const tree = treeOf(ready([artifact({ title: '' })]));
    expect(tree.getTreeItem(tree.getChildren()[0]!).label).toBe('Untitled');
  });

  it('acts on the list on screen', () => {
    const tree = treeOf(ready([artifact({ slug: 'kept' })]));
    expect(tree.artifact('kept')?.slug).toBe('kept');
    expect(tree.artifact('gone')).toBeUndefined();
  });
});

describe('updatedText', () => {
  it('reads recent work in days, older work in dates', () => {
    expect(updatedText(at(2026, 9, 28, 8), NOW, 'fr')).toBe('today');
    expect(updatedText(at(2026, 9, 27, 23), NOW, 'fr')).toBe('yesterday');
    expect(updatedText(at(2026, 9, 25), NOW, 'fr')).toBe('3 d ago');
    expect(norm(updatedText(at(2026, 9, 2), NOW, 'fr'))).toBe('2 sept.');
    expect(norm(updatedText(at(2025, 12, 24), NOW, 'fr'))).toBe('24 déc. 2025');
    expect(updatedText(undefined, NOW, 'fr')).toBe('');
  });

  it('reads a date ahead of the clock — another machine — as today', () => {
    expect(updatedText(at(2026, 9, 29), NOW, 'fr')).toBe('today');
  });
});

describe('artifactSlugOfNode', () => {
  it('reads the slug of an artifact row, and nothing else', () => {
    const node: ArtifactNode = { kind: 'artifact', artifact: artifact({ slug: 'ArtTest01' }) };
    expect(artifactSlugOfNode(node)).toBe('ArtTest01');
    for (const v of [undefined, null, 'x', { kind: 'empty' }, { kind: 'artifact', artifact: { slug: 1 } }]) {
      expect(artifactSlugOfNode(v)).toBeUndefined();
    }
  });
});
