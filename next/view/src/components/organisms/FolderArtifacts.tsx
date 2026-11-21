import { useEffect, useState, type DragEvent } from 'react';
import type { FolderArtifactView } from '../../../../src/shared/protocol';
import type { ViewCtx } from '../../context';
import { cx } from '../../lib/cx';
import { menuContext } from '../../lib/menu-context';
import { placeIn } from '../../sections';
import { Icon } from '../atoms/Icon';
import { IconButton } from '../atoms/IconButton';
import { ArtifactLine } from '../molecules/ArtifactLine';
import { SubGroup } from '../molecules/SubGroup';
import type { Dnd } from './folder-dnd';

/**
 * The artifacts filed in a folder (16/11), between its conversations and its
 * closed ones: set to the right under their own heading — the artifacts'
 * icon and their count — which folds them away, as the closed conversations
 * fold. A click opens the page; the × takes it out of the folder, and
 * nothing happens on claude.ai. Dragged onto another folder, it moves there;
 * dropped on another of its folder's rows (21/11), it lands above it — on the
 * row's top half — or below it, and the folder keeps that order.
 *
 * Filed from the Artifacts tab (an artifact's « ⋯ »). One still on claude.ai's
 * list has the artifacts' right-click menu; one that left it keeps its row,
 * under the title it was filed with.
 */
export function FolderArtifacts({ ctx, folder, artifacts, dnd }: { ctx: ViewCtx; folder: string; artifacts: readonly FolderArtifactView[]; dnd: Dnd }) {
  const { t, snapshot } = ctx;
  const key = `${folder}:artifacts`;
  const { drag, setDrag } = dnd;
  /** The row a dragged artifact of this folder would land against, and on which side. */
  const [over, setOver] = useState<{ slug: string; after: boolean } | undefined>();
  useEffect(() => {
    if (drag === undefined) setOver(undefined);
  }, [drag]);
  const mine = drag?.kind === 'artifact' && drag.from === folder ? drag.slug : undefined;
  const sideOf = (e: DragEvent<HTMLElement>): boolean => {
    const r = e.currentTarget.getBoundingClientRect();
    return e.clientY > r.top + r.height / 2;
  };
  return (
    <SubGroup
      foldKey={key}
      folded={ctx.isFolded(key)}
      onToggle={() => ctx.toggle(key)}
      label={t('folder.artifacts', { n: artifacts.length })}
      marker={<Icon name="doc" size={13} />}
      count={artifacts.length}
      headProps={{ 'data-flip-anchor': key, 'data-flip-folded': String(ctx.isFolded(key)) }}
    >
      {artifacts.map((a) => {
        const listed = snapshot.artifacts?.items.find((x) => x.slug === a.slug);
        const name = a.title || t('artifacts.untitled');
        const busy = ctx.isBusy(a.slug);
        return (
          <div
            key={a.slug}
            className={cx(
              'arow',
              busy && 'busy',
              drag?.kind === 'artifact' && drag.slug === a.slug && 'dragging',
              dnd.landed === a.slug && 'landed',
              over?.slug === a.slug && (over.after ? 'drop-below' : 'drop-above'),
            )}
            aria-busy={busy}
            data-kv-menu={listed === undefined ? undefined : menuContext('kvnArtifact', { kvnSlug: a.slug, kvnTitle: listed.title, kvnPinned: listed.pinned })}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.effectAllowed = 'move';
              e.dataTransfer.setData('text/plain', name);
              setDrag({ kind: 'artifact', slug: a.slug, title: a.title, from: folder });
            }}
            onDragEnd={() => setDrag(undefined)}
            onDragOver={(e) => {
              if (mine === undefined || mine === a.slug) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
              const after = sideOf(e);
              if (over?.slug !== a.slug || over.after !== after) setOver({ slug: a.slug, after });
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node | null) && over?.slug === a.slug) setOver(undefined);
            }}
            onDrop={(e) => {
              if (mine === undefined || mine === a.slug) return;
              e.preventDefault();
              e.stopPropagation();
              setOver(undefined);
              setDrag(undefined);
              const list = artifacts.map((x) => x.slug);
              const next = placeIn(list, mine, a.slug, sideOf(e));
              if (next.join() !== list.join()) void ctx.track(mine, ctx.act({ kind: 'artifact.folderOrder', folder, slugs: next }));
            }}
          >
            <div className="arow-line">
              <ArtifactLine name={name} openLabel={`${name} — ${t('artifacts.open')}`} onOpen={() => ctx.bridge.post({ type: 'openArtifact', slug: a.slug })} />
              <span className="tools">
                <IconButton icon="close" label={t('folder.artifactOut')} onClick={() => void ctx.track(a.slug, ctx.act({ kind: 'artifact.folder', slug: a.slug, title: a.title }))} />
              </span>
            </div>
          </div>
        );
      })}
    </SubGroup>
  );
}
