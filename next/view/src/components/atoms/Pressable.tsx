import type { ReactNode } from 'react';
import { cx } from '../../lib/cx';

/**
 * A whole card that acts as a button — a click, Enter or the space bar — and
 * may still hold buttons of its own: a key pressed on one of those is theirs,
 * and their click must stop before it gets here.
 */
export function Pressable({
  className,
  onPress,
  busy = false,
  context,
  children,
}: {
  className: string;
  onPress(): void;
  /** What it started is under way: the card shows it loading. */
  busy?: boolean;
  /** What a right-click on it offers (lib/menu-context.ts). */
  context?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cx(className, busy && 'opening')}
      role="button"
      tabIndex={0}
      aria-busy={busy}
      data-vscode-context={context}
      onClick={onPress}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget || (e.key !== 'Enter' && e.key !== ' ')) return;
        e.preventDefault();
        onPress();
      }}
    >
      {children}
    </div>
  );
}
