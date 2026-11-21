import { useEffect, useState, type DragEvent, type HTMLAttributes } from 'react';
import { MAX_NAME } from '../../../../src/shared/actions';
import type { ArtifactView } from '../../../../src/shared/protocol';
import type { ViewCtx } from '../../context';
import { cx } from '../../lib/cx';
import { menuContext } from '../../lib/menu-context';
import { dropsInto } from '../../sections';
import { IconButton } from '../atoms/IconButton';
import { NameInput } from '../molecules/Inline';
import { Menu, MenuItem } from '../molecules/Menu';
import { Popover } from '../molecules/Popover';
import { Section } from '../molecules/Section';
import type { ArtifactDnd } from './artifact-dnd';
import { ArtifactRow } from './ArtifactRow';

/**
 * A project's folder of artifacts. Projects start folded: the list is long
 * and « Recent » already shows what is fresh. A named one has, as a Sessions
 * folder does, a « ⋯ » at its right under the pointer (16/11), and its menu
 * renames it in place; « Other » is no project and has none.
 *
 * An artifact dragged onto it — its heading or its rows, folded or not — is
 * filed in it (16/11); onto « Other », it leaves its project.
 *
 * A named project is dragged by its heading to another place among the
 * projects (21/11): dropped on the top half of another, it lands before it;
 * on the bottom half, after it; on « Other », after them all.
 *
 * `made`: a folder made by hand (« New folder »), which shows though it holds
 * nothing — and, while it holds nothing, can be deleted from its menu. Any
 * other project goes away by itself with its last artifact.
 */
export function ProjectSection({ ctx, project, items, dnd, made = false }: { ctx: ViewCtx; project: string | undefined; items: readonly ArtifactView[]; dnd: ArtifactDnd; made?: boolean }) {
  const { t } = ctx;
  const key = `proj:${project ?? ''}`;
  // Folded unless opened: the fold list holds the projects that are open.
  const folded = !ctx.isFolded(key);
  const [menu, setMenu] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [over, setOver] = useState(false);
  /** Where a dragged project would land against this one: before it, after it. */
  const [side, setSide] = useState<'before' | 'after' | undefined>();
  const { drag, moving } = dnd;
  const accepts = drag !== undefined && dropsInto(drag.project, project);
  const takes = moving !== undefined && moving !== project;
  // A drag that ends anywhere else leaves nothing lit here.
  useEffect(() => {
    if (drag === undefined) setOver(false);
  }, [drag]);
  useEffect(() => {
    if (moving === undefined) setSide(undefined);
  }, [moving]);
  const sideOf = (e: DragEvent<HTMLElement>): 'before' | 'after' => {
    // Onto « Other »: after every project, which is right above it.
    if (project === undefined) return 'before';
    const r = e.currentTarget.getBoundingClientRect();
    return e.clientY > r.top + r.height / 2 ? 'after' : 'before';
  };
  const sectionProps: HTMLAttributes<HTMLElement> = {
    onDragOver: (e: DragEvent<HTMLElement>) => {
      if (takes) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        const at = sideOf(e);
        if (side !== at) setSide(at);
        return;
      }
      if (!accepts) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (!over) setOver(true);
    },
    onDragLeave: (e: DragEvent) => {
      if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
      setOver(false);
      setSide(undefined);
    },
    onDrop: (e: DragEvent<HTMLElement>) => {
      if (takes) {
        e.preventDefault();
        setSide(undefined);
        dnd.place(moving, project, sideOf(e) === 'after');
        return;
      }
      if (!accepts || drag === undefined) return;
      e.preventDefault();
      setOver(false);
      dnd.file(drag, project ?? null);
    },
  };
  const rename = (to: string | undefined): void => {
    setRenaming(false);
    if (project === undefined || to === undefined || to === project) return;
    void ctx.act({ kind: 'artifact.renameProject', from: project, to, slugs: items.map((a) => a.slug) });
  };
  const title = project === undefined ? t('artifacts.other') : renaming ? <NameInput initial={project} max={MAX_NAME} label={t('folder.rename')} onDone={rename} /> : project;
  const tools =
    project === undefined ? undefined : (
      <>
        <IconButton icon="more" label={t('folder.menu', { name: project })} expanded={menu} onClick={() => setMenu((m) => !m)} />
        {menu && (
          <Popover label={t('folder.menu', { name: project })} onClose={() => setMenu(false)}>
            <Menu label={t('folder.menu', { name: project })}>
              <MenuItem
                icon="edit"
                onClick={() => {
                  setMenu(false);
                  setRenaming(true);
                }}
              >
                {t('folder.rename')}
              </MenuItem>
              {made && items.length === 0 && (
                <MenuItem
                  icon="trash"
                  danger
                  onClick={() => {
                    setMenu(false);
                    void ctx.act({ kind: 'artifact.deleteProject', name: project });
                  }}
                >
                  {t('artifacts.deleteProject')}
                </MenuItem>
              )}
            </Menu>
          </Popover>
        )}
      </>
    );
  // Where what was just dropped landed: this project's heading lights up a moment.
  const here = dnd.landed !== undefined && dnd.landed.project === project;
  return (
    <Section
      className={cx(over && accepts && 'drop-in', takes && side === 'before' && 'drop-before', takes && side === 'after' && 'drop-after', moving === project && project !== undefined && 'dragging', here && 'landed')}
      title={title}
      count={items.length}
      folded={folded && !renaming}
      {...(renaming ? {} : { onToggle: () => ctx.toggle(key) })}
      tools={tools}
      sectionProps={sectionProps}
      // A named project renames from its right-click menu too (15/11), and is dragged by its heading — but while its name is typed (21/11).
      headProps={
        project === undefined
          ? undefined
          : {
              'data-kv-menu': menuContext('kvnArtProject', { kvnName: project }),
              ...(renaming
                ? {}
                : {
                    draggable: true,
                    onDragStart: (e: DragEvent<HTMLHeadingElement>) => {
                      e.dataTransfer.effectAllowed = 'move';
                      e.dataTransfer.setData('text/plain', project);
                      dnd.setMoving(project);
                    },
                    onDragEnd: () => dnd.setMoving(undefined),
                  }),
            }
      }
    >
      {items.length === 0 && <p className="hint drop-hint">{t('artifacts.emptyProject')}</p>}
      {items.map((a) => (
        <ArtifactRow key={a.slug} ctx={ctx} a={a} dnd={dnd} landed={here && dnd.landed?.slug === a.slug} />
      ))}
    </Section>
  );
}
