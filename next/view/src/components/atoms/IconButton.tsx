import type { MouseEvent } from 'react';
import { cx } from '../../lib/cx';
import { Icon, type IconName } from './Icon';

/**
 * A button that is an icon and nothing else: its name is its `aria-label`,
 * which the tip layer shows under the pointer (atoms/Tip.tsx). `tool` is the
 * small one of rows and headings; `head` the framed one of the header.
 */
export function IconButton({
  icon,
  label,
  onClick,
  kind = 'tool',
  size,
  className,
  pressed,
  expanded,
  busy,
}: {
  icon: IconName;
  label: string;
  onClick(e: MouseEvent<HTMLButtonElement>): void;
  kind?: 'tool' | 'head';
  size?: number;
  /** What sets it apart where it sits: `hover-only`, `danger`… */
  className?: string;
  pressed?: boolean;
  expanded?: boolean;
  /** Its action is under way: said to screen readers, and shown by the stylesheet. */
  busy?: boolean;
}) {
  return (
    <button
      type="button"
      className={cx(kind === 'head' ? 'ibtn' : 'tbtn', className, busy === true && 'busy')}
      aria-label={label}
      aria-pressed={pressed}
      aria-expanded={expanded}
      aria-busy={busy}
      onClick={onClick}
    >
      {size === undefined ? <Icon name={icon} /> : <Icon name={icon} size={size} />}
    </button>
  );
}
