import type { SessionView } from '../../../../src/shared/protocol';
import type { ViewCtx } from '../../context';
import { formatAge, isQuietTool, toolLabel } from '../../format';
import { Dot } from '../atoms/Icon';
import { IconButton } from '../atoms/IconButton';
import { Pressable } from '../atoms/Pressable';
import { SessionName } from '../atoms/SessionName';

/**
 * The conversations that wait for an answer, as cards — under the « waiting
 * for you » count, on hover (21/11; they were a « For you » section over the
 * list until then). The whole card goes to the conversation (15/11) and loads
 * until it is in front; its × closes it until the conversation moves again.
 */
export function Inbox({ ctx, waiting, onOpen }: { ctx: ViewCtx; /** Already sorted, the closed ones left out. */ waiting: readonly SessionView[]; onOpen?(): void }) {
  const { t, now } = ctx;
  if (waiting.length === 0) return null;
  return (
    <div className="inbox">
      {waiting.map((s) => (
        <Pressable
          key={s.id}
          className="ask ask-go"
          busy={ctx.reopening.has(s.id)}
          onPress={() => {
            ctx.open(s.id);
            onOpen?.();
          }}
        >
          <div className="ask-h">
            {/* It turns as it does in the list (15/11): the same conversation, the same wait. */}
            <Dot tone="wait" animate={ctx.animate} />
            <span className="txt">
              <span className="ttl conv-ttl">
                <SessionName s={s} t={t} animate={ctx.animate} />
              </span>
              <span className="muted small">{now - s.lastEventAt < 60_000 ? t('inbox.justNow') : t('inbox.since', { d: formatAge(now - s.lastEventAt, t) })}</span>
            </span>
            <IconButton
              icon="close"
              label={t('inbox.dismiss')}
              className="ask-x"
              onClick={(e) => {
                e.stopPropagation();
                ctx.dismiss(s.id, s.lastEventAt);
              }}
            />
          </div>
          {/* What it waits on — but not a question's tool name, which says nothing the card does not (15/11). */}
          {s.pendingPermission !== undefined && !isQuietTool(s.pendingPermission.tool) && (
            <span className="q mono">
              <b>{toolLabel(s.pendingPermission.tool)}</b> {s.pendingPermission.summary}
            </span>
          )}
        </Pressable>
      ))}
    </div>
  );
}
