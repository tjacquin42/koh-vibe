import type { ViewCtx } from '../../context';
import { formatAge } from '../../format';
import { Dot } from '../../components/atoms/Icon';
import { ActivityLine } from '../../components/molecules/ActivityLine';
import { OpenCard } from '../../components/molecules/OpenCard';
import { sessionContext } from '../../components/organisms/SessionRow';
import { ActivityName, activityOf, Loading, toneFor } from './activity';

/** B. A tile per conversation, with the last things it did. */
export function Wall({ ctx, folder }: { ctx: ViewCtx; folder: string | null }) {
  const { t, now } = ctx;
  const a = activityOf(ctx, folder);
  if (a === undefined) return <Loading ctx={ctx} />;
  if (a.sessions.length === 0) return <p className="hint pad">{t('wall.empty')}</p>;
  return (
    <div className="wall">
      {a.sessions.map((s) => (
        <OpenCard key={s.id} ctx={ctx} id={s.id} className="tile" context={sessionContext(ctx, s.id, a.listed.get(s.id))}>
          <span className="tile-h">
            <Dot tone={toneFor(s.id, a.listed)} animate={ctx.animate} />
            <span className="ttl conv-ttl">
              <ActivityName ctx={ctx} a={s} listed={a.listed} />
            </span>
            <span className="tm">{formatAge(now - s.lastAt, t)}</span>
          </span>
          <span className="muted small">
            {s.project}
            {s.subagents > 0 && ` · ${s.subagents} ${t('feed.subagent')}${s.subagents > 1 ? 's' : ''}`}
          </span>
          <span className="tile-b">
            {s.tail.length === 0 && <span className="muted">{t('wall.quiet')}</span>}
            {s.tail.map((i, k) => (
              <ActivityLine key={k} ctx={ctx} i={i} withTime={false} />
            ))}
          </span>
        </OpenCard>
      ))}
    </div>
  );
}
