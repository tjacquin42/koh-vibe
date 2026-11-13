import type { RoutineView } from '../../../src/shared/protocol';
import { routineSections } from '../sections';
import { formatWhen } from '../format';
import { Section } from '../ui/Section';
import type { ViewCtx } from './context';

export function RoutinesTab({ ctx }: { ctx: ViewCtx }) {
  const { t, snapshot } = ctx;
  const items = snapshot.routines?.items ?? [];
  if (items.length === 0) return <p className="hint pad">{t('routines.none')}</p>;
  return (
    <>
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
  const live = r.group !== 'paused';
  return (
    <div className="card">
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
    </div>
  );
}
