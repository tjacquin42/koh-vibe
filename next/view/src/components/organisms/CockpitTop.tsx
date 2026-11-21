import type { ReactNode } from 'react';
import type { ViewCtx } from '../../context';
import { countsOf, UNFILED } from '../../format';
import { FOLDER_COLORS } from '../../lib/colors';
import { Icon } from '../atoms/Icon';
import { EdgeScroll } from '../molecules/EdgeScroll';
import { StatusCounts } from '../molecules/StatusCounts';

/**
 * The top of the cockpit (14/11): the folders side by side — ∞ for every
 * conversation — and the counts of the one chosen.
 */
export function CockpitTop({ ctx, folder, onFolder }: { ctx: ViewCtx; folder: string | null; onFolder(v: string | null): void }) {
  const { t, snapshot } = ctx;
  const counts = countsOf(folder === null ? snapshot.sessions : snapshot.sessions.filter((s) => ctx.where.get(s.id) === folder));
  const chip = (id: string | null, body: ReactNode, label?: string) => (
    <button key={id ?? 'all'} type="button" role="radio" aria-checked={folder === id} aria-label={label} className="fchip" onClick={() => onFolder(id)}>
      {body}
    </button>
  );
  return (
    <div className="ck-top">
      <EdgeScroll className="fchips" label={t('cockpit.folders')}>
        {chip(null, <Icon name="infinity" size={16} />, t('cockpit.allFolders'))}
        {snapshot.folders.map((f) =>
          chip(
            f.id,
            <>
              <span className="fold" style={{ background: (f.color !== undefined ? FOLDER_COLORS[f.color] : undefined) ?? 'var(--line)' }} />
              {f.name}
            </>,
          ),
        )}
        {chip(
          UNFILED,
          <>
            <Icon name="hourglass" />
            {t('folder.temporary')}
          </>,
        )}
      </EdgeScroll>
      {/* Plain counts here (21/11): no list on hover, no darkening, no rainbow. */}
      <StatusCounts counts={counts} t={t} />
    </div>
  );
}
