import type { ViewCtx } from '../context';
import { formatAge } from '../format';
import { FIVE_HOURS_MS, usageLines, WEEK_MS } from '../sections';
import { Gauge } from '../components/molecules/Gauge';
import { Hungriest } from '../components/organisms/Hungriest';

/** The full tab — the sidebar's, and the cockpit's view of the same name: every limit, with the exact moment it resets, then where it went. */
export function UsageTab({ ctx }: { ctx: ViewCtx }) {
  const { t, snapshot, now } = ctx;
  const u = snapshot.usage;
  return (
    <>
      {u === undefined ? (
        <p className="hint pad">{t('usage.none')}</p>
      ) : (
        <>
          <h2 className="sec sec-label">{t('usage.limits')}</h2>
          <div className="meters">
            {usageLines(u, t).map((l) => (
              <Gauge key={l.key} ctx={ctx} label={l.label} w={l.w} span={l.key === '5h' ? FIVE_HOURS_MS : WEEK_MS} />
            ))}
          </div>
          <p className="hint pad">
            {t('usage.read', { d: formatAge(Math.max(0, now - u.at), t) })} · {t(`usage.source.${u.source}`)}
          </p>
        </>
      )}
      <Hungriest ctx={ctx} />
    </>
  );
}
