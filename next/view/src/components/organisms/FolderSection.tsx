import { useCallback, useState, type DragEvent, type HTMLAttributes } from 'react';
import { FOLDER_COLOR_IDS, MAX_NAME } from '../../../../src/shared/actions';
import type { FolderView, SessionView } from '../../../../src/shared/protocol';
import type { ViewCtx } from '../../context';
import { UNFILED } from '../../format';
import { cx } from '../../lib/cx';
import { FOLDER_COLORS } from '../../lib/colors';
import { menuContext } from '../../lib/menu-context';
import { dropOrder, sortSessions } from '../../sections';
import { Dot } from '../atoms/Icon';
import { IconButton } from '../atoms/IconButton';
import { Confirm, NameInput } from '../molecules/Inline';
import { Menu, MenuItem } from '../molecules/Menu';
import { Popover } from '../molecules/Popover';
import { Section } from '../molecules/Section';
import { SubGroup } from '../molecules/SubGroup';
import { FolderArtifacts } from './FolderArtifacts';
import type { Dnd } from './folder-dnd';
import { SessionRow } from './SessionRow';

/**
 * One folder — or the unfiled list — with its menu and its drop targets.
 *
 * A conversation dropped on a row lands in front of it, dropped anywhere
 * else in the section it lands at the end; dropped on the unfiled list it
 * leaves its folder. A folder dragged by its heading lands in front of the
 * folder it is dropped on; an artifact dragged out of a folder moves to the
 * one it is dropped on. Each drop is one write (actions.ts).
 *
 * Inside: its conversations, its artifacts (16/11), then its closed
 * conversations — the last two each under a small heading that folds them.
 */
export function FolderSection({ ctx, f, byId, dnd }: { ctx: ViewCtx; f: FolderView; byId: ReadonlyMap<string, SessionView>; dnd: Dnd }) {
  const { t } = ctx;
  const real = f.id !== UNFILED;
  const [menu, setMenu] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const closeMenu = useCallback((): void => setMenu(false), []);
  const [over, setOver] = useState<string | undefined>();
  const { drag, setDrag } = dnd;
  // The order picked in the settings; a drag still sets the hand-made one (manual).
  const sessions = sortSessions(
    f.sessionIds.map((id) => byId.get(id)).filter((s): s is SessionView => s !== undefined),
    ctx.sort,
  );

  const fileHere = (id: string, before?: string): void => {
    const order = dropOrder(f.sessionIds, [id], before);
    void ctx.act(real ? { kind: 'session.file', ids: [id], folder: f.id, order } : { kind: 'session.file', ids: [id], order });
  };
  const accepts = drag !== undefined && (drag.kind === 'session' || (real && (drag.kind === 'artifact' ? drag.from : drag.id) !== f.id));
  const end = (): void => {
    setDrag(undefined);
    setOver(undefined);
  };
  const sectionProps: HTMLAttributes<HTMLElement> = {
    onDragOver: (e: DragEvent) => {
      if (!accepts) return;
      e.preventDefault();
      if (over === undefined) setOver('end');
    },
    onDragLeave: (e: DragEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(undefined);
    },
    onDrop: (e: DragEvent) => {
      if (!accepts || drag === undefined) return;
      e.preventDefault();
      if (drag.kind === 'session') fileHere(drag.id);
      else if (drag.kind === 'artifact') {
        dnd.land(drag.slug);
        void ctx.track(drag.slug, ctx.act({ kind: 'artifact.folder', slug: drag.slug, title: drag.title, folder: f.id }));
      }
      else void ctx.act({ kind: 'folder.move', ids: [drag.id], before: f.id });
      end();
    },
  };
  const live = sessions.filter((x) => x.endedAt === undefined);
  const ended = sessions.filter((x) => x.endedAt !== undefined);
  const artifacts = f.artifacts ?? [];
  const endedKey = `${f.id}:ended`;
  const endedFolded = ctx.isFolded(endedKey);
  // Opening a folder that holds only sleeping conversations opens them too:
  // a folder that unfolds onto one closed line has shown nothing (14/11).
  const toggleFolder = (): void => {
    const opening = ctx.isFolded(f.id);
    ctx.toggle(f.id);
    if (opening && live.length === 0 && ended.length > 0 && endedFolded) ctx.toggle(endedKey);
  };
  const draggingSession = drag?.kind === 'session';
  const row = (parent: string) => (s: SessionView) => (
    <div
      key={s.id}
      data-flip={s.id}
      data-flip-parent={parent}
      className={cx('drag-row', over === s.id && draggingSession && 'drop-line', draggingSession && drag.id === s.id && 'dragging')}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', s.id);
        setDrag({ kind: 'session', id: s.id });
      }}
      onDragEnd={end}
      onDragOver={(e) => {
        if (!draggingSession) return;
        e.preventDefault();
        e.stopPropagation();
        if (over !== s.id) setOver(s.id);
      }}
      onDrop={(e) => {
        if (!draggingSession) return;
        e.preventDefault();
        e.stopPropagation();
        fileHere(drag.id, s.id);
        end();
      }}
    >
      <SessionRow ctx={ctx} s={s} />
    </div>
  );
  const body = (
    <>
      {sessions.length === 0 && artifacts.length === 0 && <p className="hint drop-hint">{t('folder.empty')}</p>}
      {live.map(row(f.id))}
      {artifacts.length > 0 && <FolderArtifacts ctx={ctx} folder={f.id} artifacts={artifacts} dnd={dnd} />}
      {ended.length > 0 && (
        // The closed ones, under the others: one icon and a count, no words, set a little to the right.
        <SubGroup
          foldKey={endedKey}
          folded={endedFolded}
          onToggle={() => ctx.toggle(endedKey)}
          label={t('folder.ended', { n: ended.length })}
          marker={<Dot tone="ended" animate={false} size={13} />}
          count={ended.length}
          headProps={{
            'data-flip': `head:${endedKey}`,
            'data-flip-parent': f.id,
            'data-flip-anchor': endedKey,
            'data-flip-folded': String(endedFolded),
            // It holds the sleeping ones, folded or not: one put to sleep goes down into it, not up into the folder (15/11).
            'data-flip-holds': ended.map((x) => x.id).join(' '),
          }}
        >
          {ended.map(row(`${endedKey} ${f.id}`))}
        </SubGroup>
      )}
    </>
  );
  // Out of every folder (14/11): no heading, at the bottom of the list —
  // still where a dragged conversation goes to leave its folder.
  if (!real) {
    return (
      <section className={cx('loose', over !== undefined && draggingSession && 'drop-in')} aria-label={t('folder.temporary')} {...sectionProps}>
        {sessions.length === 0 ? <p className="hint drop-hint">{t('folder.looseDrop')}</p> : body}
      </section>
    );
  }
  const color = f.color !== undefined ? FOLDER_COLORS[f.color] : undefined;
  const folded = ctx.isFolded(f.id);
  const title = renaming ? (
    <NameInput
      initial={f.name}
      max={MAX_NAME}
      label={t('folder.rename')}
      onDone={(name) => {
        setRenaming(false);
        if (name !== undefined && name !== f.name) void ctx.act({ kind: 'folder.rename', id: f.id, name });
      }}
    />
  ) : (
    f.name
  );
  return (
    <Section
      className={cx('folder', over !== undefined && (drag?.kind === 'folder' ? 'drop-before' : 'drop-in'), ctx.isBusy(`new:${f.id}`) && 'busy')}
      title={title}
      count={f.sessionIds.length}
      marker={<span className="fold" style={{ background: color ?? 'var(--line)' }} />}
      folded={folded && !renaming}
      {...(renaming ? {} : { onToggle: toggleFolder })}
      sectionProps={sectionProps}
      headProps={{
        'data-flip-anchor': f.id,
        'data-flip-folded': String(folded),
        'data-vscode-context': menuContext('kvnFolder', { kvnFolderId: f.id, kvnName: f.name, kvnColor: f.color }),
        // Dragged by its heading — but while its name is being typed.
        ...(renaming
          ? {}
          : {
              draggable: true,
              onDragStart: (e) => {
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', f.name);
                setDrag({ kind: 'folder', id: f.id });
              },
              onDragEnd: end,
            }),
      }}
      tools={
        <>
          {/* At the row's end: a new conversation, filed right here (14/11). */}
          <IconButton icon="plus" label={t('folder.newSessionIn', { name: f.name })} onClick={() => void ctx.track(`new:${f.id}`, ctx.act({ kind: 'session.new', folder: f.id }), 4_000)} />
          <IconButton icon="more" label={t('folder.menu', { name: f.name })} expanded={menu} onClick={() => setMenu((m) => !m)} />
          {menu && (
            // Floats under the button, over the conversations; shown folded or not (14/11).
            <Popover label={t('folder.menu', { name: f.name })} onClose={closeMenu}>
              <FolderMenu ctx={ctx} f={f} onClose={closeMenu} onRename={() => setRenaming(true)} />
            </Popover>
          )}
        </>
      }
    >
      {body}
    </Section>
  );
}

/** What a folder's « ⋯ » offers; deleting asks first, in the same place. */
function FolderMenu({ ctx, f, onClose, onRename }: { ctx: ViewCtx; f: FolderView; onClose(): void; onRename(): void }) {
  const { t } = ctx;
  const [confirming, setConfirming] = useState(false);
  /** Closes the menu, then does it. */
  const then = (what: () => void) => (): void => {
    onClose();
    what();
  };
  if (confirming) {
    return (
      <Confirm danger yes={t('folder.delete')} no={t('action.cancel')} onYes={then(() => void ctx.act({ kind: 'folder.delete', id: f.id }))} onNo={() => setConfirming(false)}>
        {t('folder.deleteConfirm', { name: f.name, n: f.sessionIds.length })}
      </Confirm>
    );
  }
  return (
    <Menu label={t('folder.menu', { name: f.name })}>
      <MenuItem icon="plus" onClick={then(() => void ctx.act({ kind: 'session.new', folder: f.id }))}>
        {t('folder.newSession')}
      </MenuItem>
      <MenuItem icon="edit" onClick={then(onRename)}>
        {t('folder.rename')}
      </MenuItem>
      <MenuItem icon="chat" onClick={then(() => void ctx.act({ kind: 'folder.rules', id: f.id, mode: 'add' }))}>
        {t('folder.addRule')}
      </MenuItem>
      <MenuItem icon="doc" onClick={then(() => void ctx.act({ kind: 'folder.rules', id: f.id, mode: 'open' }))}>
        {t('folder.openRules')}
      </MenuItem>
      <div className="swatches" role="radiogroup" aria-label={t('folder.color')}>
        <button type="button" role="radio" aria-checked={f.color === undefined} aria-label={t('folder.noColor')} className="sw none" onClick={() => void ctx.act({ kind: 'folder.color', id: f.id, color: null })} />
        {FOLDER_COLOR_IDS.map((c) => (
          <button key={c} type="button" role="radio" aria-checked={f.color === c} aria-label={c} className="sw" style={{ background: FOLDER_COLORS[c] }} onClick={() => void ctx.act({ kind: 'folder.color', id: f.id, color: c })} />
        ))}
      </div>
      <MenuItem icon="trash" danger onClick={() => setConfirming(true)}>
        {t('folder.delete')}
      </MenuItem>
    </Menu>
  );
}
