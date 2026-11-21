import type { ReactNode } from 'react';
import type { Counts } from '../../format';
import type { Translate } from '../../i18n';

/**
 * The three counts — waiting for you, working, finished — over the sidebar's
 * list and the cockpit's views (16/11): one component for both, in English in
 * every language, as the cockpit's views are named. The number and its name
 * on one line, small; on a bar too narrow, the name goes under its number
 * rather than being cut. `waiting` takes the first one's place: the count
 * that shows what waits on hover (organisms/WaitingCount.tsx).
 */
export function StatusCounts({ counts, t, waiting }: { counts: Counts; t: Translate; waiting?: ReactNode }) {
  return (
    <div className="counts">
      {waiting ?? <StatusCount n={counts.waiting} label={t('cockpit.count.waiting')} tone="wait" />}
      <StatusCount n={counts.running} label={t('cockpit.count.running')} tone="run" />
      <StatusCount n={counts.done} label={t('cockpit.count.done')} tone="done" />
    </div>
  );
}

function StatusCount({ n, label, tone }: { n: number; label: string; tone: 'wait' | 'run' | 'done' }) {
  return (
    <div className={`count tone-${tone}`}>
      <b>{n}</b>
      <span>{label}</span>
    </div>
  );
}
