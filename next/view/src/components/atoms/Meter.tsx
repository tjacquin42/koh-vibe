/**
 * A limit's bar: how much is used, and the pace mark (15/11) — a small
 * upright line where the use should be at most by now, for the limit to last
 * until it resets. The view's clock ticks every 30 seconds; the mark glides
 * there over those 30 seconds, never jumps (app.css `.pace`).
 */
export function Meter({ label, percent, tone, pace, paceLabel }: { label: string; percent: number; tone: 'wait' | 'run'; pace?: number; paceLabel?: string }) {
  return (
    <div className="bar" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label={label}>
      <span className={`fill tone-${tone}`} style={{ width: `${percent}%` }} />
      {pace !== undefined && <span className="pace" style={{ left: `${pace}%` }} title={paceLabel} />}
    </div>
  );
}
