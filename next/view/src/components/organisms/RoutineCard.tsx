import { useState } from 'react';
import type { RoutineView } from '../../../../src/shared/protocol';
import type { ViewCtx } from '../../context';
import { formatAge, formatWhen } from '../../format';
import { menuContext } from '../../lib/menu-context';
import { IconButton } from '../atoms/IconButton';
import { Confirm } from '../molecules/Inline';

/** A routine: when it runs next, whether one runs now, and what to do with it. */
export function RoutineCard({ ctx, r }: { ctx: ViewCtx; r: RoutineView }) {
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
        {/* A run under way (15/11): it shows, and for how long. */}
        {r.runningSince !== undefined && (
          <span className="state running" title={t('routines.runningSince', { d: formatAge(Math.max(0, now - r.runningSince), t) })}>
            <span className="spinner" aria-hidden="true" />
            {t('routines.running')}
          </span>
        )}
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
            <IconButton icon="copy" label={t('routines.copyLink')} onClick={() => void ctx.act({ kind: 'routine.copyLink', id: r.id })} />
            <IconButton icon="external" label={t('routines.open')} onClick={() => void ctx.act({ kind: 'routine.open', id: r.id })} />
          </span>
        </div>
      )}
    </div>
  );
}
