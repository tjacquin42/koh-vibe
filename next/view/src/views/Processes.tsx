import type { ViewCtx } from '../context';
import { toneOf } from '../format';
import { Dot } from '../components/atoms/Icon';
import { IconButton } from '../components/atoms/IconButton';
import { SessionName } from '../components/atoms/SessionName';
import { Section } from '../components/molecules/Section';
import { ProcessRow } from '../components/organisms/ProcessRow';

export function ProcessesTab({ ctx }: { ctx: ViewCtx }) {
  const { t, snapshot } = ctx;
  const procs = snapshot.processes;
  if (procs === undefined) return <p className="hint pad">{t('processes.reading')}</p>;
  const sessions = snapshot.sessions.filter((s) => (procs.bySession[s.id]?.length ?? 0) > 0);
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
            <IconButton icon="unfoldAll" label={t('processes.unfoldAll')} onClick={() => ctx.setFolded(keys, false)} />
            <IconButton icon="foldAll" label={t('processes.foldAll')} onClick={() => ctx.setFolded(keys, true)} />
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
