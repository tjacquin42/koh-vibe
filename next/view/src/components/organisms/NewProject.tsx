import { useEffect, useState } from 'react';
import { MAX_NAME } from '../../../../src/shared/actions';
import type { ViewCtx } from '../../context';
import { cx } from '../../lib/cx';
import { Icon } from '../atoms/Icon';
import { NameInput } from '../molecules/Inline';
import type { ArtifactDnd, ArtifactDrag } from './artifact-dnd';

/**
 * « New project », at the foot of the projects while an artifact is carried
 * (16/11): a project exists only through what is filed in it, so a new one is
 * made by dropping its first artifact here — then naming it, in place.
 * Escape, or an empty name, leaves the artifact where it was.
 */
export function NewProject({ ctx, dnd }: { ctx: ViewCtx; dnd: ArtifactDnd }) {
  const { t } = ctx;
  const [naming, setNaming] = useState<ArtifactDrag | undefined>();
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
            if (name !== undefined) dnd.file(naming, name);
          }}
        />
      </div>
    );
  }
  if (drag === undefined) return null;
  return (
    <div
      className={cx('new-folder drop-zone', over && 'drop-in')}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (!over) setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setNaming(drag);
        dnd.setDrag(undefined);
      }}
    >
      <Icon name="plus" /> {t('artifacts.newProject')}
    </div>
  );
}
