import type { ViewCtx } from '../../context';
import { formatAge, isQuietTool, toolLabel } from '../../format';
import { waitingForYou } from '../../sections';
import { Dot } from '../atoms/Icon';
import { IconButton } from '../atoms/IconButton';
import { Pressable } from '../atoms/Pressable';
import { SessionName } from '../atoms/SessionName';

/**
 * « For you »: the conversations that wait for an answer, the one that has
 * waited longest first. The whole card goes to the conversation (15/11) and
 * loads until it is in front; its × closes it until the conversation moves
 * again.
 */
export function Inbox({ ctx }: { ctx: ViewCtx }) {
  const { t, now } = ctx;
  const waiting = waitingForYou(ctx.snapshot).filter((s) => !ctx.isDismissed(s.id, s.lastEventAt));
  if (waiting.length === 0) return null;
  return (
    <section className="inbox" aria-label={t('inbox.title')}>
      <h2 className="sec">
        {t('inbox.title')} <span className="n">{waiting.length}</span>
      </h2>
      {waiting.map((s) => (
        <Pressable key={s.id} className="ask ask-go" busy={ctx.reopening.has(s.id)} onPress={() => ctx.open(s.id)}>
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
    </section>
  );
}
