import type { UsageWindowView } from '../../../src/shared/protocol';
import { formatAge, formatWhen } from '../format';
import { usageLines } from '../sections';
import type { ViewCtx } from './context';

/** The full tab: every limit, with the exact moment it resets. */
export function UsageTab({ ctx }: { ctx: ViewCtx }) {
  const { t, snapshot, now } = ctx;
  const u = snapshot.usage;
  if (u === undefined) return <p className="hint pad">{t('usage.none')}</p>;
  return (
    <>
      <h2 className="sec sec-label">{t('usage.limits')}</h2>
      <div className="meters">
        {usageLines(u, t).map((l) => (
          <Gauge key={l.key} ctx={ctx} label={l.label} w={l.w} exact />
        ))}
      </div>
      <p className="hint pad">
        {t('usage.read', { d: formatAge(Math.max(0, now - u.at), t) })} · {t(`usage.source.${u.source}`)}
      </p>
    </>
  );
}

/** The compact strip under the other tabs: 5 hours and the week only. */
/**
 * The usage at the foot of the sidebar: one line per limit — name, bar,
 * percentage, reset — half the height the two-line gauges took (14/11). The
 * Usage tab keeps the full ones. Hidden from the settings.
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
          {u.fiveHour !== undefined && <LineGauge ctx={ctx} label={t('usage.fiveHourShort')} w={u.fiveHour} />}
          {u.weekly !== undefined && <LineGauge ctx={ctx} label={t('usage.weeklyShort')} w={u.weekly} />}
        </>
      )}
    </section>
  );
}

function LineGauge({ ctx, label, w }: { ctx: ViewCtx; label: string; w: UsageWindowView }) {
  const { t, now } = ctx;
  const p = Math.max(0, Math.min(100, Math.round(w.percent)));
  const tone = p >= 85 ? 'wait' : 'run';
  const resets = w.resetsAt !== undefined && w.resetsAt > now ? w.resetsAt : undefined;
  return (
    <div className="lgauge">
      <span className="lg-l">{label}</span>
      <div className="bar" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={p} aria-label={label}>
        <span className={`fill tone-${tone}`} style={{ width: `${p}%` }} />
      </div>
      <span className="mono lg-p">{p} %</span>
      <span className="lg-r">{resets !== undefined ? formatAge(resets - now, t) : ''}</span>
    </div>
  );
}

function Gauge({ ctx, label, w, exact = false }: { ctx: ViewCtx; label: string; w: UsageWindowView; exact?: boolean }) {
  const { t, now, language } = ctx;
  const p = Math.max(0, Math.min(100, Math.round(w.percent)));
  const tone = p >= 85 ? 'wait' : 'run';
  const resets = w.resetsAt !== undefined && w.resetsAt > now ? w.resetsAt : undefined;
  return (
    <div className="gauge">
      <div className="g-l1">
        <span>{label}</span>
        <span className="mono">{p} %</span>
      </div>
      <div className="bar" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={p} aria-label={label}>
        <span className={`fill tone-${tone}`} style={{ width: `${p}%` }} />
      </div>
      {resets !== undefined && (
        <span className="g-l2">
          {exact
            ? t('usage.resetAt', { when: formatWhen(resets, now, language), d: formatAge(resets - now, t) })
            : t('usage.resets', { d: formatAge(resets - now, t) })}
        </span>
      )}
    </div>
  );
}
