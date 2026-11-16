import { useEffect, useRef, useState } from 'react';
import { MAX_TITLE, type Action } from '../../../../src/shared/actions';
import type { ArtifactView } from '../../../../src/shared/protocol';
import type { ViewCtx } from '../../context';
import { formatAge } from '../../format';
import { cx } from '../../lib/cx';
import { menuContext } from '../../lib/menu-context';
import { Icon } from '../atoms/Icon';
import { IconButton } from '../atoms/IconButton';
import { ArtifactLine } from '../molecules/ArtifactLine';
import { Confirm, NameInput } from '../molecules/Inline';
import { Menu, MenuItem } from '../molecules/Menu';
import { Popover } from '../molecules/Popover';
import type { ArtifactDnd } from './artifact-dnd';

type Panel = 'menu' | 'rename' | 'folder' | 'delete';

/** How long a row says where it was just filed. */
const FILED_MS = 2_200;

/**
 * An artifact: a click opens it; its pin, and a « ⋯ » for the rest. With
 * `dnd` — in the Artifacts tab — it is carried to another project by
 * dragging it (16/11); `landed` marks the row that just arrived there.
 */
export function ArtifactRow({ ctx, a, dnd, landed = false }: { ctx: ViewCtx; a: ArtifactView; dnd?: ArtifactDnd; landed?: boolean }) {
  const { t, now, snapshot } = ctx;
  const [panel, setPanel] = useState<Panel | undefined>();
  const name = a.title || t('artifacts.untitled');
  const close = (): void => setPanel(undefined);
  const busy = ctx.isBusy(a.slug);
  /** Closes the menu, then does it — the row busy until it shows. */
  const run = (action: Action) => {
    close();
    return ctx.track(a.slug, ctx.act(action));
  };
  // The folder of conversations it was just filed in, said on the row for a moment (16/11).
  const [filedIn, setFiledIn] = useState<string | undefined>();
  const filedTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(filedTimer.current), []);
  const fileIn = (folder: { id: string; name: string }): void => {
    void run({ kind: 'artifact.folder', slug: a.slug, title: a.title, folder: folder.id }).then((r) => {
      if (!r.ok) return;
      setFiledIn(folder.name);
      window.clearTimeout(filedTimer.current);
      filedTimer.current = window.setTimeout(() => setFiledIn(undefined), FILED_MS);
    });
  };
  return (
    <div
      className={cx('arow', panel !== undefined && 'open', busy && 'busy', dnd?.drag?.slug === a.slug && 'dragging', landed && 'landed')}
      aria-busy={busy}
      data-vscode-context={menuContext('kvnArtifact', { kvnSlug: a.slug, kvnTitle: a.title, kvnPinned: a.pinned })}
      // Not while its name is being typed: the field's own selection must not start a drag.
      draggable={dnd !== undefined && panel !== 'rename' ? true : undefined}
      onDragStart={
        dnd === undefined
          ? undefined
          : (e) => {
              e.dataTransfer.effectAllowed = 'move';
              e.dataTransfer.setData('text/plain', name);
              close();
              dnd.setDrag({ slug: a.slug, project: a.project });
            }
      }
      onDragEnd={dnd === undefined ? undefined : () => dnd.setDrag(undefined)}
    >
      <div className="arow-line">
        {panel === 'rename' ? (
          <span className="row">
            <Icon name="doc" />
            <NameInput
              initial={a.title}
              label={t('artifacts.rename')}
              max={MAX_TITLE}
              onDone={(title) => {
                close();
                if (title !== undefined && title !== a.title) void ctx.track(a.slug, ctx.act({ kind: 'artifact.rename', slug: a.slug, title }));
              }}
            />
          </span>
        ) : (
          <ArtifactLine
            name={name}
            openLabel={`${name} — ${t('artifacts.open')}`}
            onOpen={() => ctx.bridge.post({ type: 'openArtifact', slug: a.slug })}
            age={a.updatedAt === undefined ? undefined : formatAge(now - a.updatedAt, t)}
            filedIn={filedIn === undefined ? undefined : t('artifacts.filedIn', { name: filedIn })}
            moving={ctx.animate}
          />
        )}
        {/* While renaming, the field takes the whole row: no tools over its end. */}
        {panel !== 'rename' && (
          <span className="tools">
            <IconButton icon="pin" label={a.pinned ? t('artifacts.unpin') : t('artifacts.pin')} pressed={a.pinned} onClick={() => void ctx.track(a.slug, ctx.act({ kind: 'artifact.pin', slug: a.slug, pinned: !a.pinned }))} />
            <IconButton icon="more" label={t('artifacts.menu', { name })} expanded={panel !== undefined} onClick={() => setPanel((p) => (p === undefined ? 'menu' : undefined))} />
          </span>
        )}
        {panel !== undefined && panel !== 'rename' && (
          // Floats under the row's tools, over the list: nothing below moves (14/11).
          <Popover label={t('artifacts.menu', { name })} onClose={close}>
            {panel === 'menu' && (
              <Menu label={t('artifacts.menu', { name })}>
                <MenuItem icon="edit" onClick={() => setPanel('rename')}>
                  {t('artifacts.rename')}
                </MenuItem>
                {snapshot.folders.length > 0 && (
                  <MenuItem icon="list" onClick={() => setPanel('folder')}>
                    {t('artifacts.toFolder')}
                  </MenuItem>
                )}
                <MenuItem icon="copy" onClick={() => void run({ kind: 'artifact.copyLink', slug: a.slug })}>
                  {t('artifacts.copyLink')}
                </MenuItem>
                <MenuItem icon="trash" danger onClick={() => setPanel('delete')}>
                  {t('artifacts.delete')}
                </MenuItem>
              </Menu>
            )}
            {panel === 'folder' && (
              <Menu label={t('artifacts.toFolder')}>
                {snapshot.folders.map((f) => (
                  <MenuItem key={f.id} icon="list" onClick={() => fileIn(f)}>
                    {f.name}
                  </MenuItem>
                ))}
                <MenuItem icon="close" onClick={() => void run({ kind: 'artifact.folder', slug: a.slug, title: a.title })}>
                  {t('artifacts.noFolder')}
                </MenuItem>
              </Menu>
            )}
            {panel === 'delete' && (
              <Confirm
                danger
                yes={t('artifacts.delete')}
                no={t('action.cancel')}
                onYes={() =>
                  void run({ kind: 'artifact.delete', slug: a.slug }).then((r) => {
                    if (r.ok) ctx.notify(t('artifacts.deleted', { name }));
                  })
                }
                onNo={close}
              >
                {t('artifacts.deleteConfirm', { name })}
              </Confirm>
            )}
          </Popover>
        )}
      </div>
    </div>
  );
}
