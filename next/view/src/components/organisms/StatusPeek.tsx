import { useCallback, useEffect, useRef, useState } from 'react';
import type { SessionView } from '../../../../src/shared/protocol';
import type { ViewCtx } from '../../context';
import { cx } from '../../lib/cx';
import { inTone, type PeekTone } from '../../sections';
import { Popover } from '../molecules/Popover';
import { Inbox } from './Inbox';

/** How long the list stays once the pointer has left — time to cross the gap into it. */
const HIDE_MS = 220;

const LABEL = { wait: 'cockpit.count.waiting', run: 'cockpit.count.running', done: 'cockpit.count.done' } as const;

/**
 * One of the sidebar's three counts (21/11) — waiting for you, working,
 * finished. Hovering it, or pressing it, shows the conversations it counts,
 * the latest on top; a card goes to its conversation. « waiting for you »
 * also darkens, as a notification does, while something waits, and the
 * rainbow the name runs on a click crosses it every 10 seconds. The cockpit
 * keeps its plain counts.
 */
export function StatusPeek({ ctx, tone, sessions }: { ctx: ViewCtx; tone: PeekTone; sessions: readonly SessionView[] }) {
  const { t } = ctx;
  const listed = inTone(sessions, tone);
  const any = listed.length > 0;
  const asking = tone === 'wait' && any;
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const close = useCallback(() => setOpen(false), []);
  const shown = open && any;
  const label = t(LABEL[tone]);
  return (
    <div
      className="count-wrap"
      onMouseEnter={() => {
        clearTimeout(timer.current);
        if (any) setOpen(true);
      }}
      onMouseLeave={() => {
        clearTimeout(timer.current);
        timer.current = setTimeout(close, HIDE_MS);
      }}
    >
      <button
        type="button"
        className={cx(`count tone-${tone}`, any && 'peekable', asking && 'asking', asking && ctx.animate && 'moving')}
        aria-haspopup={any ? 'dialog' : undefined}
        aria-expanded={any ? shown : undefined}
        aria-disabled={!any}
        onClick={() => {
          if (any) setOpen((v) => !v);
        }}
      >
        <span className="count-ink">
          <b>{listed.length}</b>
          <span>{label}</span>
        </span>
      </button>
      {shown && (
        <Popover label={label} onClose={close}>
          <div className="waiting-pop">
            <Inbox ctx={ctx} tone={tone} sessions={listed} onOpen={close} />
          </div>
        </Popover>
      )}
    </div>
  );
}
