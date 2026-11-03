import { describe, expect, it, vi } from 'vitest';
import { DataTransfer, DataTransferItem, TreeItemCollapsibleState } from 'vscode';
import type { Artifact } from '../src/artifacts/model';
import type { ArtifactProjects } from '../src/artifacts/projects';
import type { FeedView } from '../src/cloud/feed';
import { updatedText } from '../src/ui/artifact-labels';
import {
  ArtifactsTree,
  artifactNodeId,
  artifactSlugOfNode,
  projectOfNode,
  selectedSlugs,
  type ArtifactNode,
} from '../src/ui/artifacts-tree';

// The view's own type: written out rather than imported, because the exact
// value is part of its contract — same rule as test/tree-dnd.test.ts.
const MIME = 'application/vnd.code.tree.kohvibe.artifacts';

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

describe('the artifacts view, by project', () => {
  const projects = (filed: Record<string, string | null>): ArtifactProjects => ({ filed, aliases: {}, unknown: {} });

  const filedTree = (items: Artifact[], filed: Record<string, string | null>, onFile = vi.fn(async () => undefined)) => {
    const tree = new ArtifactsTree(onFile);
    tree.setFeed(ready(items), NOW, 'fr');
    tree.setProjects(projects(filed));
    return { tree, onFile };
  };

  it('shows one folder per project, by name, Other last — folded, with how many each holds', () => {
    const { tree } = filedTree(
      [artifact({ slug: 'n1' }), artifact({ slug: 'n2' }), artifact({ slug: 'k' }), artifact({ slug: 'loose' })],
      { n1: 'NTI', n2: 'NTI', k: 'koh-vibe' },
    );
    const rows = tree.getChildren();
    const items = rows.map((r) => tree.getTreeItem(r));
    expect(items.map((i) => i.label)).toEqual(['koh-vibe', 'NTI', 'Other']);
    expect(items.map((i) => i.description)).toEqual(['1', '2', '1']);
    expect(items.map((i) => i.contextValue)).toEqual(['project.named', 'project.named', 'project.other']);
    for (const item of items) expect(item.collapsibleState).toBe(TreeItemCollapsibleState.Collapsed);
    expect(new Set(items.map((i) => i.id)).size).toBe(3);
  });

  it('lists a folder’s artifacts as the flat list did: pinned first, then the most recent', () => {
    const { tree } = filedTree(
      [
        artifact({ slug: 'old', updatedAt: at(2026, 8, 30) }),
        artifact({ slug: 'pin', pinned: true, updatedAt: at(2026, 9, 1) }),
        artifact({ slug: 'new', updatedAt: at(2026, 9, 27) }),
      ],
      { old: 'NTI', pin: 'NTI', new: 'NTI' },
    );
    const project = tree.getChildren().find((n) => n.kind === 'project');
    expect(tree.getChildren(project).map(artifactNodeId)).toEqual([
      'artifact:project:NTI/pin',
      'artifact:project:NTI/new',
      'artifact:project:NTI/old',
    ]);
  });

  it('files an artifact never filed under the project its title names', () => {
    const { tree } = filedTree(
      [artifact({ slug: 'a', updatedAt: at(2026, 9, 27) }), artifact({ slug: 'b', title: 'NTI — logos', updatedAt: at(2026, 9, 1) })],
      { a: 'NTI' },
    );
    const folder = tree.getChildren().find((n) => n.kind === 'project');
    expect(tree.getChildren(folder).map(artifactNodeId)).toEqual(['artifact:project:NTI/a', 'artifact:project:NTI/b']);
  });

  it('puts the pinned on top and the most recent next, each also left in its own project', () => {
    const items = [
      ...Array.from({ length: 12 }, (_, i) => artifact({ slug: `n${i}`, updatedAt: at(2026, 9, 1 + i) })),
      artifact({ slug: 'pin', pinned: true, updatedAt: at(2026, 8, 1) }),
    ];
    const { tree } = filedTree(items, Object.fromEntries(items.map((a) => [a.slug, 'NTI'])));
    const rows = tree.getChildren();
    const items0 = rows.map((r) => tree.getTreeItem(r));
    expect(items0.map((i) => i.label)).toEqual(['Pinned', 'Recent', 'NTI']);
    expect(items0.map((i) => i.iconPath)).toMatchObject([{ id: 'pinned' }, { id: 'history' }, { id: 'folder' }]);
    expect(items0.map((i) => i.collapsibleState)).toEqual([
      TreeItemCollapsibleState.Expanded,
      TreeItemCollapsibleState.Expanded,
      TreeItemCollapsibleState.Collapsed,
    ]);
    expect(items0.map((i) => i.description)).toEqual(['1', '10', '13']);
    expect(tree.getChildren(rows[0]).map((n) => artifactSlugOfNode(n))).toEqual(['pin']);
    // The ten most recently updated, newest first — a pinned page too, were it recent.
    expect(tree.getChildren(rows[1]).map((n) => artifactSlugOfNode(n))).toEqual(
      ['n11', 'n10', 'n9', 'n8', 'n7', 'n6', 'n5', 'n4', 'n3', 'n2'],
    );
    // One page on several rows: each row its own id, as VSCode requires.
    const ids = rows.flatMap((r) => tree.getChildren(r)).map(artifactNodeId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('shows no Pinned folder when nothing is pinned, and takes no drop on either', async () => {
    const { tree, onFile } = filedTree([artifact({ slug: 'a', updatedAt: at(2026, 9, 1) })], { a: 'NTI' });
    const rows = tree.getChildren();
    expect(rows.map((r) => tree.getTreeItem(r).label)).toEqual(['Recent', 'NTI']);
    const data = new DataTransfer();
    data.set(MIME, new DataTransferItem(['a']));
    await tree.handleDrop(rows[0], data);
    expect(onFile).not.toHaveBeenCalled();
    // Dropped on a page in Recent: into that page's own project.
    await tree.handleDrop(tree.getChildren(rows[0])[0], data);
    expect(onFile).toHaveBeenCalledWith(['a'], 'NTI');
  });

  it('stays a flat list while nothing is filed under a project', () => {
    const { tree } = filedTree([artifact({ slug: 'a' }), artifact({ slug: 'b' })], { a: null });
    expect(tree.getChildren().map((n) => n.kind)).toEqual(['artifact', 'artifact']);
  });

  it('picks up the artifacts of the rows dragged, and nothing of a folder', () => {
    const { tree } = filedTree([artifact({ slug: 'a' }), artifact({ slug: 'b' })], { a: 'NTI' });
    const [folder] = tree.getChildren();
    const rows = tree.getChildren(folder);
    const data = new DataTransfer();
    tree.handleDrag([...rows, folder!], data);
    expect(data.get(MIME)?.value).toEqual(['a']);
    const empty = new DataTransfer();
    tree.handleDrag([folder!], empty);
    expect(empty.get(MIME)).toBeUndefined();
  });

  it('files what is dropped into the folder it lands on — or into the folder of the row it lands on', async () => {
    const { tree, onFile } = filedTree([artifact({ slug: 'a' }), artifact({ slug: 'b' }), artifact({ slug: 'c' })], {
      a: 'NTI',
      b: 'koh-vibe',
    });
    const [kohVibe, nti, other] = tree.getChildren();
    const dragged = (slugs: unknown): DataTransfer => {
      const data = new DataTransfer();
      data.set(MIME, new DataTransferItem(slugs));
      return data;
    };
    await tree.handleDrop(nti, dragged(['c']));
    expect(onFile).toHaveBeenLastCalledWith(['c'], 'NTI');
    await tree.handleDrop(other, dragged(['a']));
    expect(onFile).toHaveBeenLastCalledWith(['a'], null);
    await tree.handleDrop(tree.getChildren(kohVibe)[0], dragged(['c']));
    expect(onFile).toHaveBeenLastCalledWith(['c'], 'koh-vibe');
    expect(onFile).toHaveBeenCalledTimes(3);
  });

  it('files nothing dropped in the flat list — there is no folder to drop into', async () => {
    // A row's folder is « Other » there; filing into it on such a drop would
    // mark the page as « Other » chosen, for good, without anything showing it.
    const { tree, onFile } = filedTree([artifact({ slug: 'a' }), artifact({ slug: 'b' })], {});
    const data = new DataTransfer();
    data.set(MIME, new DataTransferItem(['a']));
    await tree.handleDrop(tree.getChildren()[1], data);
    expect(onFile).not.toHaveBeenCalled();
  });

  it('ignores a drop on nothing, and anything that is not a list of artifacts', async () => {
    const { tree, onFile } = filedTree([artifact({ slug: 'a' })], { a: 'NTI' });
    const [nti] = tree.getChildren();
    const data = new DataTransfer();
    data.set(MIME, new DataTransferItem(['a']));
    await tree.handleDrop(undefined, data);
    for (const value of ['a', [1], [], ['../x'], { slugs: ['a'] }]) {
      const odd = new DataTransfer();
      odd.set(MIME, new DataTransferItem(value));
      await tree.handleDrop(nti, odd);
    }
    await tree.handleDrop(nti, new DataTransfer());
    expect(onFile).not.toHaveBeenCalled();
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

describe('selectedSlugs', () => {
  const row = (slug: string): ArtifactNode => ({ kind: 'artifact', artifact: artifact({ slug }) });

  it('acts on the whole selection when the row clicked is part of it', () => {
    expect(selectedSlugs(row('b'), [row('a'), row('b'), { kind: 'project', project: 'NTI' }])).toEqual(['a', 'b']);
  });

  it('acts on the row clicked alone when it is outside the selection, or there is none', () => {
    expect(selectedSlugs(row('c'), [row('a'), row('b')])).toEqual(['c']);
    expect(selectedSlugs(row('c'), undefined)).toEqual(['c']);
    expect(selectedSlugs({ kind: 'project', project: 'NTI' }, [row('a')])).toEqual([]);
  });
});

describe('projectOfNode', () => {
  it('reads the project of a named folder row, and nothing else — Other included', () => {
    expect(projectOfNode({ kind: 'project', project: 'NTI' })).toBe('NTI');
    for (const v of [undefined, null, 'NTI', { kind: 'project' }, { kind: 'project', project: 3 }, { kind: 'artifact', project: 'NTI' }]) {
      expect(projectOfNode(v)).toBeUndefined();
    }
  });
});
