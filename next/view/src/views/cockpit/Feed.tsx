import type { ViewCtx } from '../../context';
import { sessionTitle } from '../../format';
import { Dot } from '../../components/atoms/Icon';
import { ActivityLine } from '../../components/molecules/ActivityLine';
import { activityOf, Loading, toneFor } from './activity';

/** D. Everything every conversation did, the latest first; a line opens its conversation's sheet. */
export function Feed({ ctx, folder }: { ctx: ViewCtx; folder: string | null }) {
  const { t } = ctx;
  const a = activityOf(ctx, folder);
  const activity = ctx.snapshot.activity;
  if (a === undefined || activity === undefined) return <Loading ctx={ctx} />;
  const items = activity.feed.filter((i) => a.filed(i.sessionId));
  if (items.length === 0) return <p className="hint pad">{t('feed.empty')}</p>;
  const titles = new Map(activity.sessions.map((s) => [s.id, s.title ?? s.project]));
  for (const s of ctx.snapshot.sessions) titles.set(s.id, sessionTitle(s, t));
  return (
    <ol className="feed">
      {items.map((i, k) => (
        <li key={`${i.at}-${k}`}>
          <button type="button" className="feed-row" onClick={() => ctx.show(i.sessionId)}>
            <Dot tone={toneFor(i.sessionId, a.listed)} animate={false} size={12} />
            <span className="who">{titles.get(i.sessionId) ?? i.sessionId}</span>
            <span className="feed-box">
              <ActivityLine ctx={ctx} i={i} withTime />
            </span>
          </button>
        </li>
      ))}
    </ol>
  );
}
