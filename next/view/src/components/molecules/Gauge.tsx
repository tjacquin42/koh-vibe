import type { UsageWindowView } from '../../../../src/shared/protocol';
import type { ViewCtx } from '../../context';
import { formatAge, formatWhen } from '../../format';
import { gaugeOf, pacePercent } from '../../sections';
import { Meter } from '../atoms/Meter';

interface GaugeProps {
  ctx: ViewCtx;
  label: string;
  w: UsageWindowView;
  /** How long the limit runs before it resets, for its pace mark. */
  span: number;
}

/** A limit's bar, with its pace mark where there is a reset to go by. */
function LimitMeter({ ctx, label, w, span }: GaugeProps) {
  const g = gaugeOf(w, ctx.now);
  const pace = pacePercent(w.resetsAt, span, ctx.now);
  return <Meter label={label} percent={g.percent} tone={g.tone} pace={pace} paceLabel={pace === undefined ? undefined : ctx.t('usage.pace', { p: Math.round(pace) })} />;
}

/** A limit on two lines, in the Usage tab: its name and percentage, its bar, the exact moment it resets. */
export function Gauge(props: GaugeProps) {
  const { ctx, label, w } = props;
  const { t, now, language } = ctx;
  const g = gaugeOf(w, now);
  return (
    <div className="gauge">
      <div className="g-l1">
        <span>{label}</span>
        <span className="mono">{g.percent} %</span>
      </div>
      <LimitMeter {...props} />
      {g.resetsAt !== undefined && <span className="g-l2">{t('usage.resetAt', { when: formatWhen(g.resetsAt, now, language), d: formatAge(g.resetsAt - now, t) })}</span>}
    </div>
  );
}

/** A limit on one line, at the foot of the sidebar: name, bar, percentage, time left. */
export function LineGauge(props: GaugeProps) {
  const { ctx, label, w } = props;
  const g = gaugeOf(w, ctx.now);
  return (
    <div className="lgauge">
      <span className="lg-l">{label}</span>
      <LimitMeter {...props} />
      <span className="mono lg-p">{g.percent} %</span>
      <span className="lg-r">{g.resetsAt !== undefined ? formatAge(g.resetsAt - ctx.now, ctx.t) : ''}</span>
    </div>
  );
}
