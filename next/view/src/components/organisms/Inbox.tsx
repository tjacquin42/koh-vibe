import type { SessionView } from '../../../../src/shared/protocol';
import type { ViewCtx } from '../../context';
import { formatAge, isQuietTool, toolLabel } from '../../format';
import type { PeekTone } from '../../sections';
import { Dot } from '../atoms/Icon';
import { Pressable } from '../atoms/Pressable';
import { SessionName } from '../atoms/SessionName';

/**
 * The conversations a count counts, as cards — under the count, on hover
 * (21/11; the waiting ones were a « For you » section over the list until
 * then). The whole card goes to the conversation (15/11) and loads until it
 * is in front. No ×: a question waits until it is answered (21/11).
 */
export function Inbox({ ctx, tone, sessions, onOpen }: { ctx: ViewCtx; tone: PeekTone; /** Already sorted, the latest on top. */ sessions: readonly SessionView[]; onOpen?(): void }) {
  const { t, now } = ctx;
  if (sessions.length === 0) return null;
  const age = (s: SessionView): string => {
    if (now - s.lastEventAt < 60_000) return t('inbox.justNow');
    const d = formatAge(now - s.lastEventAt, t);
    return tone === 'wait' ? t('inbox.since', { d }) : t('inbox.ago', { d });
  };
  return (
    <div className="inbox">
      {sessions.map((s) => (
        <Pressable
          key={s.id}
          className={`ask ask-go tone-${tone}`}
          busy={ctx.reopening.has(s.id)}
          onPress={() => {
            ctx.open(s.id);
            onOpen?.();
          }}
        >
          <div className="ask-h">
            {/* It turns as it does in the list (15/11): the same conversation, the same state. */}
            <Dot tone={tone} animate={ctx.animate} />
            <span className="txt">
              <span className="ttl conv-ttl">
                <SessionName s={s} t={t} animate={ctx.animate} />
              </span>
              <span className="muted small">{age(s)}</span>
            </span>
          </div>
          {/* What it waits on — but not a question's tool name, which says nothing the card does not (15/11). */}
          {tone === 'wait' && s.pendingPermission !== undefined && !isQuietTool(s.pendingPermission.tool) && (
            <span className="q mono">
              <b>{toolLabel(s.pendingPermission.tool)}</b> {s.pendingPermission.summary}
            </span>
          )}
        </Pressable>
      ))}
    </div>
  );
}
