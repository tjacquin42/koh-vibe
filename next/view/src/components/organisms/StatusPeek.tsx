import type { SessionView } from '../../../../src/shared/protocol';
import type { ViewCtx } from '../../context';
import type { PeekGroup } from '../../hooks/usePeekGroup';
import { cx } from '../../lib/cx';
import { inTone, type PeekTone } from '../../sections';
import { Popover } from '../molecules/Popover';
import { Inbox } from './Inbox';

const LABEL = { wait: 'cockpit.count.waiting', run: 'cockpit.count.running', done: 'cockpit.count.done' } as const;

/**
 * One of the sidebar's three counts (21/11) — waiting for you, working,
 * finished. Hovering it, or pressing it, shows the conversations it counts,
 * the latest on top; a card goes to its conversation. « waiting for you »
 * also darkens, as a notification does, while something waits, and the
 * rainbow the name runs on a click crosses it every 10 seconds. The cockpit
 * keeps its plain counts. The three share one bubble (hooks/usePeekGroup.ts).
 */
export function StatusPeek({ ctx, tone, sessions, group }: { ctx: ViewCtx; tone: PeekTone; sessions: readonly SessionView[]; group: PeekGroup }) {
  const { t } = ctx;
  const listed = inTone(sessions, tone);
  const any = listed.length > 0;
  const asking = tone === 'wait' && any;
  const shown = group.state.open === tone && any;
  const leaving = group.state.leaving === tone && any;
  const label = t(LABEL[tone]);
  return (
    <div
      className="count-wrap"
      onMouseEnter={() => group.enter(tone, any)}
      onMouseLeave={() => group.leave()}
    >
      <button
        type="button"
        className={cx(`count tone-${tone}`, any && 'peekable', asking && 'asking', asking && ctx.animate && 'moving')}
        aria-haspopup={any ? 'dialog' : undefined}
        aria-expanded={any ? shown : undefined}
        aria-disabled={!any}
        onClick={() => {
          if (any) group.press(tone);
        }}
      >
        <span className="count-ink">
          <b>{listed.length}</b>
          <span>{label}</span>
        </span>
      </button>
      {(shown || leaving) && (
        <Popover label={label} onClose={group.close} leaving={leaving}>
          <div className="waiting-pop">
            <Inbox ctx={ctx} tone={tone} sessions={listed} onOpen={group.close} />
          </div>
        </Popover>
      )}
    </div>
  );
}
