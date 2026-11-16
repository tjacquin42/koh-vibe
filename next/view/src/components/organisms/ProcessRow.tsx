import type { ProcessKind, ProcessView } from '../../../../src/shared/protocol';
import type { ViewCtx } from '../../context';
import { formatAge, megabytes } from '../../format';
import { menuContext } from '../../lib/menu-context';
import { Icon, type IconName } from '../atoms/Icon';
import { IconButton } from '../atoms/IconButton';

const KIND_ICON: Record<ProcessKind, IconName> = { mcp: 'plug', shell: 'term', work: 'gear' };

/** A process a conversation runs: what it is, since when, its memory — and what to do with it. */
export function ProcessRow({ ctx, p }: { ctx: ViewCtx; p: ProcessView }) {
  const { t } = ctx;
  return (
    <div className={`proc${ctx.isBusy(`pid:${p.pid}`) ? ' busy' : ''}`} data-vscode-context={menuContext('kvnProcess', { kvnPid: p.pid })} style={{ paddingLeft: `${10 + Math.min(p.depth, 4) * 12}px` }}>
      <span className="pk" role="img" aria-label={t(`processes.kind.${p.kind}`)}>
        <Icon name={KIND_ICON[p.kind]} size={13} />
      </span>
      <span className="cmd">{p.label}</span>
      <span className="tm">{formatAge(p.elapsed * 1000, t)}</span>
      <span className="tm">{t('processes.mem', { n: megabytes(p.rss) })}</span>
      <span className="pid">{p.pid}</span>
      {/* The host finds the process again at the click and asks before terminating it (actions.ts). */}
      <span className="proc-tools">
        <IconButton icon="copy" label={t('processes.copyCommand')} onClick={() => void ctx.act({ kind: 'process.copy', pid: p.pid, what: 'command' })} />
        <button type="button" className="tbtn" aria-label={t('processes.copyPid')} onClick={() => void ctx.act({ kind: 'process.copy', pid: p.pid, what: 'pid' })}>
          <span className="mono pid-btn">#</span>
        </button>
        <IconButton icon="close" label={t('processes.kill')} className="danger" onClick={() => void ctx.track(`pid:${p.pid}`, ctx.act({ kind: 'process.kill', pid: p.pid }))} />
      </span>
    </div>
  );
}
