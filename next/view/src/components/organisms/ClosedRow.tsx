import type { ClosedView } from '../../../../src/shared/protocol';
import type { ViewCtx } from '../../context';
import { formatAge } from '../../format';
import { menuContext } from '../../lib/menu-context';
import { Dot, Icon } from '../atoms/Icon';

/** A closed conversation, in the Archives: a click brings it back when V1 has something to resume it from. */
export function ClosedRow({ ctx, c }: { ctx: ViewCtx; c: ClosedView }) {
  const { t, now } = ctx;
  const title = c.title ?? c.project;
  const age = <span className="tm">{formatAge(now - c.closedAt, t)}</span>;
  if (!c.resumable) {
    // Started outside the editor and the terminal: V1 has nothing to resume it from.
    return (
      <div className="row closed-row" data-flip={c.sessionId} data-flip-parent="closed" data-kv-menu={menuContext('kvnClosed', { kvnSessionId: c.sessionId, kvnResumable: false })}>
        <Dot tone="ended" animate={false} />
        <span className="txt">
          <span className="ttl conv-ttl">{title}</span>
          <span className="sub">{t('closed.elsewhere')}</span>
        </span>
        {age}
      </div>
    );
  }
  const waiting = ctx.reopening.has(c.sessionId);
  const notice = ctx.reopenNotice(c.sessionId);
  return (
    <div className="closed-item" data-flip={c.sessionId} data-flip-parent="closed" data-kv-menu={menuContext('kvnClosed', { kvnSessionId: c.sessionId, kvnResumable: true })}>
      <button
        type="button"
        className="row row-btn closed-row"
        disabled={waiting}
        aria-busy={waiting}
        aria-label={`${title} — ${t('closed.reopen')}`}
        onClick={() => ctx.reopen(c.sessionId)}
      >
        <Dot tone={waiting ? 'run' : 'ended'} animate={ctx.animate} />
        <span className="ttl conv-ttl">{title}</span>
        {waiting ? <span className="tm busy">{t('closed.reopening')}</span> : age}
        {!waiting && (
          <span className="go">
            <Icon name="resume" size={12} />
          </span>
        )}
      </button>
      {notice !== undefined && (
        <p className="notice" role="status">
          {t(`closed.${notice}`)}
        </p>
      )}
    </div>
  );
}
