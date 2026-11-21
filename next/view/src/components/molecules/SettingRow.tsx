import type { ReactNode } from 'react';
import { cx } from '../../lib/cx';
import { Hint } from '../atoms/Hint';
import { Switch } from '../atoms/Switch';

/** A setting's name, and what it does behind an (i) when there is something to say. */
function SettingLabel({ id, label, hint }: { id?: string; label: string; hint?: string }) {
  return (
    <div className="set-l">
      <b id={id}>{label}</b>
      {hint !== undefined && <Hint text={hint} />}
    </div>
  );
}

/** A setting with several answers: its name, the choice under it. `off`: shown, greyed, out of use. */
export function Choice({ label, hint, off = false, children }: { label: string; hint?: string; off?: boolean; children: ReactNode }) {
  return (
    <div className={cx('set-row set-choice', off && 'off')} aria-disabled={off ? true : undefined}>
      <SettingLabel label={label} hint={hint} />
      {children}
    </div>
  );
}

/** A setting that is on or off. `id` names it for its switch. */
export function SwitchRow({ id, label, hint, on, onChange }: { id: string; label: string; hint: string; on: boolean; onChange(on: boolean): void }) {
  return (
    <div className="set-row">
      <SettingLabel id={id} label={label} hint={hint} />
      <Switch on={on} labelledBy={id} onChange={onChange} />
    </div>
  );
}
