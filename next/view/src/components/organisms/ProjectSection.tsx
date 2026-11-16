import { useState } from 'react';
import { MAX_NAME } from '../../../../src/shared/actions';
import type { ArtifactView } from '../../../../src/shared/protocol';
import type { ViewCtx } from '../../context';
import { menuContext } from '../../lib/menu-context';
import { IconButton } from '../atoms/IconButton';
import { NameInput } from '../molecules/Inline';
import { Menu, MenuItem } from '../molecules/Menu';
import { Popover } from '../molecules/Popover';
import { Section } from '../molecules/Section';
import { ArtifactRow } from './ArtifactRow';

/**
 * A project's folder of artifacts. Projects start folded: the list is long
 * and « Recent » already shows what is fresh. A named one has, as a Sessions
 * folder does, a « ⋯ » at its right under the pointer (16/11), and its menu
 * renames it in place; « Other » is no project and has none.
 */
export function ProjectSection({ ctx, project, items }: { ctx: ViewCtx; project: string | undefined; items: readonly ArtifactView[] }) {
  const { t } = ctx;
  const key = `proj:${project ?? ''}`;
  // Folded unless opened: the fold list holds the projects that are open.
  const folded = !ctx.isFolded(key);
  const [menu, setMenu] = useState(false);
  const [renaming, setRenaming] = useState(false);
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
            </Menu>
          </Popover>
        )}
      </>
    );
  return (
    <Section
      title={title}
      count={items.length}
      folded={folded && !renaming}
      {...(renaming ? {} : { onToggle: () => ctx.toggle(key) })}
      tools={tools}
      // A named project renames from its right-click menu too (15/11).
      headProps={project === undefined ? undefined : { 'data-vscode-context': menuContext('kvnArtProject', { kvnName: project }) }}
    >
      {items.map((a) => (
        <ArtifactRow key={a.slug} ctx={ctx} a={a} />
      ))}
    </Section>
  );
}
