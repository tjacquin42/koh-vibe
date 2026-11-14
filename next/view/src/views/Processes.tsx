import type { ProcessKind, ProcessView, SessionView } from '../../../src/shared/protocol';
import { formatAge, megabytes, sessionTitle, toneOf } from '../format';
import { Dot, Icon, type IconName } from '../ui/icons';
import { Section } from '../ui/Section';
import type { ViewCtx } from './context';

const KIND_ICON: Record<ProcessKind, IconName> = { mcp: 'plug', shell: 'term', work: 'gear' };

/** The last directory of a path — enough to tell two projects apart on a row. */
function base(path: string): string {
  const parts = path.split('/').filter((p) => p.length > 0);
  return parts[parts.length - 1] ?? path;
}

export function ProcessesTab({ ctx }: { ctx: ViewCtx }) {
  const { t, snapshot } = ctx;
  const procs = snapshot.processes;
  if (procs === undefined) return <p className="hint pad">{t('processes.reading')}</p>;
  const sessions = snapshot.sessions.filter((s): s is SessionView => (procs.bySession[s.id]?.length ?? 0) > 0);
  return (
    <>
      {sessions.length === 0 && <p className="hint pad">{t('processes.none')}</p>}
      {sessions.map((s) => {
        const list = procs.bySession[s.id] ?? [];
        return (
          <Section key={s.id} title={sessionTitle(s, t)} count={list.length} marker={<Dot tone={toneOf(s)} animate={ctx.animate} size={13} />}>
            {list.map((p) => (
              <ProcessRow key={p.pid} ctx={ctx} p={p} />
            ))}
          </Section>
        );
      })}
      {procs.orphans === undefined ? (
        <Section title={t('processes.orphans')}>
          <p className="hint">{t('processes.reading')}</p>
        </Section>
      ) : (
        <Section title={t('processes.orphans')} count={procs.orphans.length}>
          {procs.orphans.length === 0 && <p className="hint">{t('processes.orphansNone')}</p>}
          {procs.orphans.map((o) => (
            <div key={o.tree[0]?.pid ?? o.cwd} className="orphan">
              <span className="orphan-cwd mono">{base(o.cwd)}</span>
              {o.tree.map((p) => (
                <ProcessRow key={p.pid} ctx={ctx} p={p} />
              ))}
            </div>
          ))}
        </Section>
      )}
    </>
  );
}

function ProcessRow({ ctx, p }: { ctx: ViewCtx; p: ProcessView }) {
  const { t } = ctx;
  return (
    <div className="proc" style={{ paddingLeft: `${10 + Math.min(p.depth, 4) * 12}px` }}>
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
        <button type="button" className="tbtn danger" aria-label={t('processes.kill')} onClick={() => void ctx.act({ kind: 'process.kill', pid: p.pid })}>
          <Icon name="close" />
        </button>
      </span>
    </div>
  );
}
