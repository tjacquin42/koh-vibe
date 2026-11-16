import type { ViewCtx } from '../../context';
import { formatWhen } from '../../format';
import { hourTicks, SPANS_H, timelineLanes } from '../../sections';
import { Segmented } from '../../components/atoms/Segmented';
import { ActivityName, activityOf, Loading, toneFor } from './activity';

/** G. When each conversation worked, over the last hours; a lane opens its conversation's sheet. */
export function Timeline({ ctx, folder, spanH, onSpan }: { ctx: ViewCtx; folder: string | null; spanH: number; onSpan(h: number): void }) {
  const { t, now, language } = ctx;
  const a = activityOf(ctx, folder);
  const activity = ctx.snapshot.activity;
  if (a === undefined || activity === undefined) return <Loading ctx={ctx} />;
  const span = spanH * 3_600_000;
  const lanes = timelineLanes({ ...activity, sessions: a.sessions }, now, span);
  const ticks = hourTicks(now, span, spanH > 8 ? 3 : 1);
  return (
    <>
      <Segmented label={t('timeline.span')} options={SPANS_H.map((h) => ({ value: h, label: t('timeline.hours', { n: h }) }))} value={spanH} onChange={onSpan} />
      {lanes.length === 0 ? (
        <p className="hint pad">{t('timeline.empty')}</p>
      ) : (
        <div className="tl">
          <div className="tl-axis" aria-hidden="true">
            {/* A label too close to the right edge would sit on « now ». */}
            {ticks
              .filter(([x]) => x < 0.92)
              .map(([x, at]) => (
                <span key={at} style={{ left: `${x * 100}%` }}>
                  {formatWhen(at, at, language)}
                </span>
              ))}
            <span className="tl-now">{t('timeline.now')}</span>
          </div>
          {lanes.map((l) => {
            const tone = toneFor(l.session.id, a.listed);
            return (
              <button key={l.session.id} type="button" className="tl-lane" onClick={() => ctx.show(l.session.id)}>
                <span className="tl-name">
                  <ActivityName ctx={ctx} a={l.session} listed={a.listed} />
                </span>
                <span className="tl-track">
                  {ticks.map(([x, at]) => (
                    <i key={at} className="tl-grid" style={{ left: `${x * 100}%` }} />
                  ))}
                  {l.bars.map(([x, w], k) => (
                    <i key={k} className={`tl-bar tone-${tone}`} style={{ left: `${x * 100}%`, width: `${w * 100}%` }} />
                  ))}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </>
  );
}
