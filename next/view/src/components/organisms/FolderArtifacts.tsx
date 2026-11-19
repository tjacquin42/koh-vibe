import type { FolderArtifactView } from '../../../../src/shared/protocol';
import type { ViewCtx } from '../../context';
import { cx } from '../../lib/cx';
import { menuContext } from '../../lib/menu-context';
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
 * nothing happens on claude.ai. Dragged onto another folder, it moves there.
 *
 * Filed from the Artifacts tab (an artifact's « ⋯ »). One still on claude.ai's
 * list has the artifacts' right-click menu; one that left it keeps its row,
 * under the title it was filed with.
 */
export function FolderArtifacts({ ctx, folder, artifacts, dnd }: { ctx: ViewCtx; folder: string; artifacts: readonly FolderArtifactView[]; dnd: Dnd }) {
  const { t, snapshot } = ctx;
  const key = `${folder}:artifacts`;
  const { drag, setDrag } = dnd;
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
            className={cx('arow', busy && 'busy', drag?.kind === 'artifact' && drag.slug === a.slug && 'dragging', dnd.landed === a.slug && 'landed')}
            aria-busy={busy}
            data-vscode-context={listed === undefined ? undefined : menuContext('kvnArtifact', { kvnSlug: a.slug, kvnTitle: listed.title, kvnPinned: listed.pinned })}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.effectAllowed = 'move';
              e.dataTransfer.setData('text/plain', name);
              setDrag({ kind: 'artifact', slug: a.slug, title: a.title, from: folder });
            }}
            onDragEnd={() => setDrag(undefined)}
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
