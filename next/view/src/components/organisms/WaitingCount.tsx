import { useCallback, useEffect, useRef, useState } from 'react';
import type { SessionView } from '../../../../src/shared/protocol';
import type { ViewCtx } from '../../context';
import { countsOf } from '../../format';
import { cx } from '../../lib/cx';
import { waitingIn } from '../../sections';
import { Popover } from '../molecules/Popover';
import { Inbox } from './Inbox';

/** How long the list stays once the pointer has left — time to cross the gap into it. */
const HIDE_MS = 220;

/**
 * « waiting for you » (21/11), in place of the « For you » section: while a
 * conversation waits and its card was not closed, the count darkens, as a
 * notification does, and a rainbow runs through it every 30 seconds, the one
 * the name runs on a click. Hovering it — or pressing it — shows the
 * conversations that wait; a card goes to its conversation, its × closes it.
 */
export function WaitingCount({ ctx, sessions }: { ctx: ViewCtx; /** The conversations counted: all, or a folder's. */ sessions: readonly SessionView[] }) {
  const { t } = ctx;
  const n = countsOf(sessions).waiting;
  const waiting = waitingIn(sessions).filter((s) => !ctx.isDismissed(s.id, s.lastEventAt));
  const asking = waiting.length > 0;
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const close = useCallback(() => setOpen(false), []);
  const shown = open && asking;
  const label = t('cockpit.count.waiting');
  return (
    <div
      className="count-wrap"
      onMouseEnter={() => {
        clearTimeout(timer.current);
        if (asking) setOpen(true);
      }}
      onMouseLeave={() => {
        clearTimeout(timer.current);
        timer.current = setTimeout(close, HIDE_MS);
      }}
    >
      <button
        type="button"
        className={cx('count tone-wait', asking && 'asking', asking && ctx.animate && 'moving')}
        aria-haspopup={asking ? 'dialog' : undefined}
        aria-expanded={asking ? shown : undefined}
        aria-disabled={!asking}
        onClick={() => {
          if (asking) setOpen((v) => !v);
        }}
      >
        <span className="count-ink">
          <b>{n}</b>
          <span>{label}</span>
        </span>
      </button>
      {shown && (
        <Popover label={label} onClose={close}>
          <div className="waiting-pop">
            <Inbox ctx={ctx} waiting={waiting} onOpen={close} />
          </div>
        </Popover>
      )}
    </div>
  );
}
