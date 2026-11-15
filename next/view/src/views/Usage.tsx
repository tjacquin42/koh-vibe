import { useState } from 'react';
import type { SpendWindow, UsageWindowView } from '../../../src/shared/protocol';
import { formatAge, formatWhen, toneOf } from '../format';
import { Dot } from '../ui/icons';
import { SessionName } from '../ui/SessionName';
import { FIVE_HOURS_MS, pacePercent, usageLines, WEEK_MS } from '../sections';
import type { ViewCtx } from './context';

/** The full tab: every limit, with the exact moment it resets. */
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
              <Gauge key={l.key} ctx={ctx} label={l.label} w={l.w} span={l.key === '5h' ? FIVE_HOURS_MS : WEEK_MS} exact />
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

const SPEND_WINDOWS: readonly SpendWindow[] = ['5h', '24h', '7d'];

/**
 * The conversations that spent the most (15/11), over 5 hours, 24 hours or 7
 * days: the limits above say how much went, this says where. A share of the
 * window, estimated from the transcripts (host spend.ts). A click goes to the
 * conversation, as in the list.
 */
function Hungriest({ ctx }: { ctx: ViewCtx }) {
  const { t, snapshot } = ctx;
  const [w, setW] = useState<SpendWindow>('5h');
  const spend = snapshot.spend;
  const entries = spend?.windows[w] ?? [];
  const top = entries[0]?.share ?? 0;
  return (
    <>
      <h2 className="sec sec-label">{t('usage.top')}</h2>
      <div className="spend">
        <div className="seg" role="radiogroup" aria-label={t('usage.top')}>
          {SPEND_WINDOWS.map((x) => (
            <button key={x} type="button" role="radio" aria-checked={w === x} onClick={() => setW(x)}>
              {t(`usage.top.${x}`)}
            </button>
          ))}
        </div>
        {spend === undefined ? (
          <p className="hint">{t('usage.top.reading')}</p>
        ) : entries.length === 0 ? (
          <p className="hint">{t('usage.top.none')}</p>
        ) : (
          entries.map((e) => {
            const s = snapshot.sessions.find((x) => x.id === e.sessionId);
            const closed = snapshot.closed.find((c) => c.sessionId === e.sessionId);
            const p = Math.round(e.share * 100);
            const go = (): void => {
              if (s !== undefined) ctx.open(e.sessionId);
              else if (closed?.resumable === true) ctx.reopen(e.sessionId);
            };
            return (
              <button
                key={e.sessionId}
                type="button"
                className={`spend-row${ctx.reopening.has(e.sessionId) ? ' opening' : ''}`}
                aria-busy={ctx.reopening.has(e.sessionId)}
                onClick={go}
                disabled={s === undefined && closed?.resumable !== true}
              >
                <span className="spend-name">
                  {s !== undefined ? <Dot tone={toneOf(s)} animate={ctx.animate} size={9} /> : <Dot tone="ended" animate={false} size={9} />}
                  <span className="ttl">{s !== undefined ? <SessionName s={s} t={t} animate={false} /> : (closed?.title ?? e.title ?? e.sessionId.slice(0, 8))}</span>
                  <span className="mono spend-p">{p < 1 ? '< 1' : p} %</span>
                </span>
                <span className="bar" aria-hidden="true">
                  <span className="fill tone-run" style={{ width: `${top === 0 ? 0 : (e.share / top) * 100}%` }} />
                </span>
              </button>
            );
          })
        )}
        <p className="hint">{t('usage.top.hint')}</p>
      </div>
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
          {u.fiveHour !== undefined && <LineGauge ctx={ctx} label={t('usage.fiveHourShort')} w={u.fiveHour} span={FIVE_HOURS_MS} />}
          {u.weekly !== undefined && <LineGauge ctx={ctx} label={t('usage.weeklyShort')} w={u.weekly} span={WEEK_MS} />}
        </>
      )}
    </section>
  );
}

function LineGauge({ ctx, label, w, span }: { ctx: ViewCtx; label: string; w: UsageWindowView; span: number }) {
  const { t, now } = ctx;
  const p = Math.max(0, Math.min(100, Math.round(w.percent)));
  const tone = p >= 85 ? 'wait' : 'run';
  const resets = w.resetsAt !== undefined && w.resetsAt > now ? w.resetsAt : undefined;
  return (
    <div className="lgauge">
      <span className="lg-l">{label}</span>
      <div className="bar" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={p} aria-label={label}>
        <span className={`fill tone-${tone}`} style={{ width: `${p}%` }} />
        <Pace ctx={ctx} w={w} span={span} />
      </div>
      <span className="mono lg-p">{p} %</span>
      <span className="lg-r">{resets !== undefined ? formatAge(resets - now, t) : ''}</span>
    </div>
  );
}

function Gauge({ ctx, label, w, span, exact = false }: { ctx: ViewCtx; label: string; w: UsageWindowView; span: number; exact?: boolean }) {
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
        <Pace ctx={ctx} w={w} span={span} />
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

/**
 * The pace mark (15/11): a small upright line where the use should be at most
 * by now, for the limit to last until it resets. The view's clock ticks every
 * 30 seconds; the mark glides there over those 30 seconds, never jumps.
 */
function Pace({ ctx, w, span }: { ctx: ViewCtx; w: UsageWindowView; span: number }) {
  const at = pacePercent(w.resetsAt, span, ctx.now);
  if (at === undefined) return null;
  return <span className="pace" style={{ left: `${at}%` }} title={ctx.t('usage.pace', { p: Math.round(at) })} />;
}
