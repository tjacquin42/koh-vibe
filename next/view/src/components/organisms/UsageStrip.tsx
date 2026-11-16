import type { ViewCtx } from '../../context';
import { FIVE_HOURS_MS, WEEK_MS } from '../../sections';
import { LineGauge } from '../molecules/Gauge';

/**
 * The usage at the foot of the sidebar: one line per limit — name, bar,
 * percentage, reset — 5 hours and the week only, half the height the two-line
 * gauges took (14/11). The Usage tab keeps the full ones. Hidden from the
 * settings.
 */
export function UsageStrip({ ctx }: { ctx: ViewCtx }) {
  const { t, snapshot } = ctx;
  const u = snapshot.usage;
  return (
    <section className="usage compact" aria-label={t('usage.title')}>
      {u === undefined ? (
        <span className="muted">{t('usage.none')}</span>
      ) : (
        <>
          {u.fiveHour !== undefined && <LineGauge ctx={ctx} label={t('usage.fiveHourShort')} w={u.fiveHour} span={FIVE_HOURS_MS} />}
          {u.weekly !== undefined && <LineGauge ctx={ctx} label={t('usage.weeklyShort')} w={u.weekly} span={WEEK_MS} />}
        </>
      )}
    </section>
  );
}
