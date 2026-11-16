import { useRef } from 'react';
import { cx } from '../../lib/cx';
import { useFlip } from '../../hooks/useFlip';
import { useIconsOnly } from '../../hooks/useIconsOnly';
import { useReorder } from '../../hooks/useReorder';
import { Icon, type IconName } from '../atoms/Icon';

/**
 * A bar of tabs — the sidebar's, the cockpit's views — one component for
 * both (16/11): an icon each and its name beside it, in the order the user
 * dragged them to (hooks/useReorder.ts). When a name would not fit, every tab
 * shows its icon alone and the name is the tooltip (hooks/useIconsOnly.ts) —
 * never a name cut short.
 */
export function TabBar<T extends string>({
  className,
  label,
  order,
  selected,
  icon,
  name,
  iconSize,
  flipKey,
  controls,
  animate,
  onSelect,
  onOrder,
}: {
  className: string;
  label: string;
  order: readonly T[];
  /** None while something else covers what the tabs show (a sheet). */
  selected: T | undefined;
  icon: Readonly<Record<T, IconName>>;
  name(id: T): string;
  iconSize?: number;
  /** What tells this bar's tabs from another's when they slide (hooks/useFlip.ts). */
  flipKey: string;
  /** The panel the tabs switch, by id. */
  controls?: string;
  animate: boolean;
  onSelect(id: T): void;
  onOrder(order: T[]): void;
}) {
  const nav = useRef<HTMLElement>(null);
  useFlip(nav, animate);
  const { shown, itemProps, barProps } = useReorder(order, onOrder);
  const iconsOnly = useIconsOnly(nav);
  return (
    <nav ref={nav} className={cx(className, iconsOnly && 'icons-only')} role="tablist" aria-label={label} {...barProps}>
      {shown.map((id) => (
        <button
          key={id}
          type="button"
          role="tab"
          data-flip={`${flipKey}:${id}`}
          data-name={name(id)}
          aria-selected={selected === id}
          aria-controls={controls}
          aria-label={iconsOnly ? name(id) : undefined}
          data-tip={iconsOnly ? name(id) : undefined}
          onClick={() => onSelect(id)}
          {...itemProps(id)}
        >
          {iconSize === undefined ? <Icon name={icon[id]} /> : <Icon name={icon[id]} size={iconSize} />}
          {!iconsOnly && <span>{name(id)}</span>}
        </button>
      ))}
    </nav>
  );
}
