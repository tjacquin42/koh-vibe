import { useEffect, useState } from 'react';
import { MAX_NAME } from '../../../../src/shared/actions';
import type { ViewCtx } from '../../context';
import { cx } from '../../lib/cx';
import { Icon } from '../atoms/Icon';
import { NameInput } from '../molecules/Inline';
import type { ArtifactDnd, ArtifactDrag } from './artifact-dnd';

/**
 * « New folder », right under the « By project » heading, as the
 * conversations have theirs (16/11): a click turns it into the field that
 * names it, and the folder exists though nothing is filed in it yet. An
 * artifact dropped on it goes straight into the folder it then names.
 * Escape, or an empty name, changes nothing.
 */
export function NewProject({ ctx, dnd }: { ctx: ViewCtx; dnd: ArtifactDnd }) {
  const { t } = ctx;
  /** Naming a folder: for the artifact dropped here, or — `'empty'` — for none. */
  const [naming, setNaming] = useState<ArtifactDrag | 'empty' | undefined>();
  const [over, setOver] = useState(false);
  const { drag } = dnd;
  useEffect(() => {
    if (drag === undefined) setOver(false);
  }, [drag]);
  if (naming !== undefined) {
    return (
      <div className="new-folder open">
        <Icon name="plus" />
        <NameInput
          initial=""
          max={MAX_NAME}
          label={t('artifacts.newProject')}
          onDone={(name) => {
            setNaming(undefined);
            if (name === undefined) return;
            if (naming === 'empty') void ctx.act({ kind: 'artifact.newProject', name });
            else dnd.file(naming, name);
          }}
        />
      </div>
    );
  }
  return (
    <button
      type="button"
      className={cx('new-folder', over && 'drop-in')}
      onClick={() => setNaming('empty')}
      onDragOver={(e) => {
        if (drag === undefined) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (!over) setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        if (drag === undefined) return;
        e.preventDefault();
        setNaming(drag);
        dnd.setDrag(undefined);
      }}
    >
      <Icon name="plus" /> {t('artifacts.newProject')}
    </button>
  );
}
