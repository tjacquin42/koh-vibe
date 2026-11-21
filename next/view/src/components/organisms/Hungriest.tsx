import type { ViewCtx } from '../../context';
import { toneOf } from '../../format';
import { SPEND_WINDOWS } from '../../ui-state';
import { Dot } from '../atoms/Icon';
import { Segmented } from '../atoms/Segmented';
import { SessionName } from '../atoms/SessionName';

/**
 * The conversations that spent the most (15/11), over 5 hours, 24 hours or 7
 * days: the limits above say how much went, this says where. A share of the
 * window, estimated from the transcripts (host spend.ts). A click goes to the
 * conversation, as in the list. The window is kept as last picked (16/11):
 * coming back to the tab finds the same.
 */
export function Hungriest({ ctx }: { ctx: ViewCtx }) {
  const { t, snapshot } = ctx;
  const spend = snapshot.spend;
  const entries = spend?.windows[ctx.spendWindow] ?? [];
  const top = entries[0]?.share ?? 0;
  return (
    <>
      <h2 className="sec sec-label">{t('usage.top')}</h2>
      <div className="spend">
        <Segmented label={t('usage.top')} options={SPEND_WINDOWS.map((w) => ({ value: w, label: t(`usage.top.${w}`) }))} value={ctx.spendWindow} onChange={ctx.setSpendWindow} />
        {spend === undefined ? (
          <p className="hint">{t('usage.top.reading')}</p>
        ) : entries.length === 0 ? (
          <p className="hint">{t('usage.top.none')}</p>
        ) : (
          entries.map((e) => {
            const s = snapshot.sessions.find((x) => x.id === e.sessionId);
            const closed = s === undefined ? snapshot.closed.find((c) => c.sessionId === e.sessionId) : undefined;
            const resumable = closed?.resumable === true;
            const p = Math.round(e.share * 100);
            const opening = ctx.reopening.has(e.sessionId);
            return (
              <button
                key={e.sessionId}
                type="button"
                className={`spend-row${opening ? ' opening' : ''}`}
                aria-busy={opening}
                disabled={s === undefined && !resumable}
                onClick={() => {
                  if (s !== undefined) ctx.open(e.sessionId);
                  else if (resumable) ctx.reopen(e.sessionId);
                }}
              >
                <span className="spend-name">
                  <Dot tone={s !== undefined ? toneOf(s) : 'ended'} animate={s !== undefined && ctx.animate} size={9} />
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
