import { useState } from 'react';
import type { RoutineView } from '../../../src/shared/protocol';
import { routineSections } from '../sections';
import { formatWhen } from '../format';
import { Icon } from '../ui/icons';
import { Confirm } from '../ui/Inline';
import { Section } from '../ui/Section';
import { menuContext } from '../ui/menu-context';
import { CloudBar } from './Artifacts';
import type { ViewCtx } from './context';

export function RoutinesTab({ ctx }: { ctx: ViewCtx }) {
  const { t, snapshot } = ctx;
  const items = snapshot.routines?.items ?? [];
  const bar = <CloudBar ctx={ctx} what="routines" at={snapshot.routines?.at} />;
  if (items.length === 0) {
    return (
      <>
        {bar}
        <p className="hint pad">{t('routines.none')}</p>
      </>
    );
  }
  return (
    <>
      {bar}
      {routineSections(items).map((s) => (
        <Section key={s.group} title={t(`routines.${s.group}`)} count={s.items.length}>
          {s.items.map((r) => (
            <RoutineCard key={r.id} ctx={ctx} r={r} />
          ))}
        </Section>
      ))}
    </>
  );
}

function RoutineCard({ ctx, r }: { ctx: ViewCtx; r: RoutineView }) {
  const { t, now, language } = ctx;
  const [asking, setAsking] = useState(false);
  const live = r.group !== 'paused';
  // V1's rules: only an active, unspent routine runs; a spent one-shot is never resumed.
  const canRun = r.enabled && !r.spent;
  return (
    <div
      className={`card${ctx.isBusy(r.id) ? ' busy' : ''}`}
      aria-busy={ctx.isBusy(r.id)}
      data-vscode-context={menuContext('kvnRoutine', { kvnRoutineId: r.id, kvnName: r.name, kvnEnabled: r.enabled, kvnCanRun: canRun, kvnCanResume: !r.enabled && !r.spent })}
    >
      <div className="card-l1">
        <span className="ttl">{r.name}</span>
        <span className={`state ${live ? 'on' : 'off'}`}>{t(live ? 'routines.on' : 'routines.off')}</span>
      </div>
      <span className="card-l2">
        {r.cron !== undefined ? t('routines.recurring') : t('routines.once')}
        {r.repos.length > 0 && <span className="mono"> · {r.repos.join(', ')}</span>}
      </span>
      <span className="card-l3">
        {live && r.nextRunAt !== undefined ? t('routines.next', { when: formatWhen(r.nextRunAt, now, language) }) : live ? '' : t('routines.idle')}
      </span>
      {asking ? (
        <Confirm
          danger={false}
          yes={t('routines.run')}
          no={t('action.cancel')}
          onYes={() => {
            setAsking(false);
            void ctx.track(r.id, ctx.act({ kind: 'routine.run', id: r.id })).then((res) => {
              if (res.ok) ctx.notify(t('routines.launched', { name: r.name }));
            });
          }}
          onNo={() => setAsking(false)}
        >
          {t('routines.runConfirm', { name: r.name })}
        </Confirm>
      ) : (
        <div className="card-acts">
          {canRun && (
            <button type="button" className="btn-ghost" onClick={() => setAsking(true)}>
              {t('routines.run')}
            </button>
          )}
          {r.enabled ? (
            <button type="button" className="btn-ghost" onClick={() => void ctx.track(r.id, ctx.act({ kind: 'routine.pause', id: r.id, paused: true }))}>
              {t('routines.pause')}
            </button>
          ) : (
            !r.spent && (
              <button type="button" className="btn-ghost" onClick={() => void ctx.track(r.id, ctx.act({ kind: 'routine.pause', id: r.id, paused: false }))}>
                {t('routines.resume')}
              </button>
            )
          )}
          <span className="card-acts-end">
            <button type="button" className="tbtn" aria-label={t('routines.copyLink')} onClick={() => void ctx.act({ kind: 'routine.copyLink', id: r.id })}>
              <Icon name="copy" />
            </button>
            <button type="button" className="tbtn" aria-label={t('routines.open')} onClick={() => void ctx.act({ kind: 'routine.open', id: r.id })}>
              <Icon name="external" />
            </button>
          </span>
        </div>
      )}
    </div>
  );
}
