import { useState } from 'react';
import { MAX_NAME } from '../../../../src/shared/actions';
import type { ViewCtx } from '../../context';
import { Icon } from '../atoms/Icon';
import { NameInput } from '../molecules/Inline';

/** « New folder », at the foot of the folders: a click turns it into the field that names it. */
export function NewFolder({ ctx }: { ctx: ViewCtx }) {
  const { t } = ctx;
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button type="button" className="new-folder" onClick={() => setOpen(true)}>
        <Icon name="plus" /> {t('folder.new')}
      </button>
    );
  }
  return (
    <div className="new-folder open">
      <Icon name="plus" />
      <NameInput
        initial=""
        max={MAX_NAME}
        label={t('folder.new')}
        onDone={(name) => {
          setOpen(false);
          if (name !== undefined) void ctx.act({ kind: 'folder.create', name });
        }}
      />
    </div>
  );
}
