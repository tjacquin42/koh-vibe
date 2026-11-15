import type { ProcessKind, ProcessView, SessionView } from '../../../src/shared/protocol';
import { formatAge, megabytes, toneOf } from '../format';
import { Dot, Icon, type IconName } from '../ui/icons';
import { Section } from '../ui/Section';
import { menuContext } from '../ui/menu-context';
import { SessionName } from '../ui/SessionName';
import type { ViewCtx } from './context';

const KIND_ICON: Record<ProcessKind, IconName> = { mcp: 'plug', shell: 'term', work: 'gear' };

export function ProcessesTab({ ctx }: { ctx: ViewCtx }) {
  const { t, snapshot } = ctx;
  const procs = snapshot.processes;
  if (procs === undefined) return <p className="hint pad">{t('processes.reading')}</p>;
  const sessions = snapshot.sessions.filter((s): s is SessionView => (procs.bySession[s.id]?.length ?? 0) > 0);
  const keys = sessions.map((s) => `proc:${s.id}`);
  // Everything goes through a conversation (15/11): no section for the processes of none.
  return (
    <>
      {sessions.length === 0 ? (
        <p className="hint pad">{t('processes.none')}</p>
      ) : (
        <div className="cloudbar proc-bar">
          <span />
          <span className="cloudbar-act">
            <button type="button" className="tbtn" aria-label={t('processes.unfoldAll')} onClick={() => ctx.setFolded(keys, false)}>
              <Icon name="unfoldAll" />
            </button>
            <button type="button" className="tbtn" aria-label={t('processes.foldAll')} onClick={() => ctx.setFolded(keys, true)}>
              <Icon name="foldAll" />
            </button>
          </span>
        </div>
      )}
      {sessions.map((s) => {
        const list = procs.bySession[s.id] ?? [];
        return (
          // Each conversation's processes fold under its heading (15/11), remembered like a folder's.
          <Section
            key={s.id}
            title={<SessionName s={s} t={t} animate={ctx.animate} />}
            count={list.length}
            marker={<Dot tone={toneOf(s)} animate={ctx.animate} size={13} />}
            folded={ctx.isFolded(`proc:${s.id}`)}
            onToggle={() => ctx.toggle(`proc:${s.id}`)}
          >
            {list.map((p) => (
              <ProcessRow key={p.pid} ctx={ctx} p={p} />
            ))}
          </Section>
        );
      })}
    </>
  );
}

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
        <button type="button" className="tbtn" aria-label={t('processes.copyCommand')} onClick={() => void ctx.act({ kind: 'process.copy', pid: p.pid, what: 'command' })}>
          <Icon name="copy" />
        </button>
        <button type="button" className="tbtn" aria-label={t('processes.copyPid')} onClick={() => void ctx.act({ kind: 'process.copy', pid: p.pid, what: 'pid' })}>
          <span className="mono pid-btn">#</span>
        </button>
        <button type="button" className="tbtn danger" aria-label={t('processes.kill')} onClick={() => void ctx.track(`pid:${p.pid}`, ctx.act({ kind: 'process.kill', pid: p.pid }))}>
          <Icon name="close" />
        </button>
      </span>
    </div>
  );
}
