import type { ViewCtx } from '../context';
import { routineSections } from '../sections';
import { Section } from '../components/molecules/Section';
import { CloudBar } from '../components/organisms/CloudBar';
import { RoutineCard } from '../components/organisms/RoutineCard';

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
