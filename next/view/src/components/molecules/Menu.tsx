import type { ReactNode } from 'react';
import { cx } from '../../lib/cx';
import { Icon, type IconName } from '../atoms/Icon';

/** The list of what a « ⋯ » offers, inside its popover. */
export function Menu({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="fmenu" role="group" aria-label={label}>
      {children}
    </div>
  );
}

/** One line of a menu: an icon and what it does; red when it destroys. */
export function MenuItem({ icon, danger = false, onClick, children }: { icon: IconName; danger?: boolean; onClick(): void; children: ReactNode }) {
  return (
    <button type="button" className={cx('fm-btn', danger && 'danger')} onClick={onClick}>
      <Icon name={icon} /> {children}
    </button>
  );
}
