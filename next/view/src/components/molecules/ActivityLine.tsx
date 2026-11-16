import type { ActivityItemView } from '../../../../src/shared/protocol';
import type { ViewCtx } from '../../context';
import { formatWhen, isQuietTool, toolLabel } from '../../format';
import { Icon, type IconName } from '../atoms/Icon';

const KIND_ICON: Record<ActivityItemView['kind'], IconName> = { prompt: 'user', text: 'chat', tool: 'gear' };

/** One thing a conversation did, on a line: what kind, the tool if one, and its text. */
export function ActivityLine({ ctx, i, withTime }: { ctx: ViewCtx; i: ActivityItemView; withTime: boolean }) {
  const { t, language } = ctx;
  return (
    <span className={`it it-${i.kind}${i.subagent ? ' it-sub' : ''}`}>
      {withTime && <span className="at">{formatWhen(i.at, i.at, language)}</span>}
      <span className="ik" role="img" aria-label={i.kind === 'tool' ? toolLabel(i.tool ?? '') : t(`feed.${i.kind}`)}>
        <Icon name={i.subagent ? 'bot' : KIND_ICON[i.kind]} size={12} />
      </span>
      {i.kind === 'tool' && i.tool !== undefined && !isQuietTool(i.tool) && (
        <b className="tn" title={i.tool}>
          {toolLabel(i.tool)}
        </b>
      )}
      <span className="tx">{i.text}</span>
    </span>
  );
}
