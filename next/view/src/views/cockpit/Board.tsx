import type { SessionView } from '../../../../src/shared/protocol';
import type { ViewCtx } from '../../context';
import { formatAge, toneOf, type Tone } from '../../format';
import { boardColumns, type BoardColumns } from '../../sections';
import { Dot } from '../../components/atoms/Icon';
import { SessionName } from '../../components/atoms/SessionName';
import { OpenCard } from '../../components/molecules/OpenCard';
import { sessionContext } from '../../components/organisms/SessionRow';

const COLUMNS: { key: keyof BoardColumns; tone: Tone | 'rest'; label: 'board.wait' | 'board.run' | 'board.done' | 'board.rest' }[] = [
  { key: 'wait', tone: 'wait', label: 'board.wait' },
  { key: 'run', tone: 'run', label: 'board.run' },
  { key: 'done', tone: 'done', label: 'board.done' },
  { key: 'rest', tone: 'rest', label: 'board.rest' },
];

/** A. One column per state, the chosen folder's conversations in them. */
export function Board({ ctx, folder }: { ctx: ViewCtx; folder: string | null }) {
  const { t } = ctx;
  const cols = boardColumns(ctx.snapshot, folder ?? undefined, ctx.where);
  return (
    <div className="board">
      {COLUMNS.map((c) => (
        <section key={c.key} className="col" aria-label={t(c.label)}>
          <h2 className="col-h">
            <Dot tone={c.tone} animate={ctx.animate} size={14} />
            {t(c.label)} <span className="n">{cols[c.key].length}</span>
          </h2>
          {cols[c.key].length === 0 && <p className="hint">{t('board.empty')}</p>}
          {cols[c.key].map((s) => (
            <SessionCard key={s.id} ctx={ctx} s={s} />
          ))}
        </section>
      ))}
    </div>
  );
}

/**
 * A click goes to the conversation; its sheet is the card's own button (15/11).
 * Its name and its age, nothing under them (16/11): where it lives and what
 * it runs are on its sheet.
 */
function SessionCard({ ctx, s }: { ctx: ViewCtx; s: SessionView }) {
  const { t, now } = ctx;
  return (
    <OpenCard ctx={ctx} id={s.id} className={`bcard tone-${toneOf(s)}`} context={sessionContext(ctx, s.id, s.endedAt !== undefined)}>
      <span className="l1">
        <span className="ttl conv-ttl">
          <SessionName s={s} t={t} animate={ctx.animate} />
        </span>
        <span className="tm">{formatAge(now - (s.endedAt ?? s.lastEventAt), t)}</span>
      </span>
    </OpenCard>
  );
}
