import type { ReactNode } from 'react';
import { Icon } from './icons';

/**
 * A foldable heading and what it holds. The fold is remembered by the view
 * (ui-state.ts) under `foldKey`; without one the section cannot fold.
 */
export function Section({
  title,
  count,
  marker,
  folded,
  onToggle,
  children,
}: {
  title: ReactNode;
  count?: number;
  marker?: ReactNode;
  folded?: boolean;
  onToggle?: () => void;
  children: ReactNode;
}) {
  const head = (
    <>
      {onToggle !== undefined && <Icon name={folded === true ? 'chevR' : 'chev'} />}
      {marker}
      <span className="sec-t">{title}</span>
      {count !== undefined && <span className="n">{count}</span>}
    </>
  );
  return (
    <section className="group">
      <h2 className="sec">
        {onToggle === undefined ? (
          head
        ) : (
          <button type="button" className="sec-btn" aria-expanded={folded !== true} onClick={onToggle}>
            {head}
          </button>
        )}
      </h2>
      {folded !== true && children}
    </section>
  );
}
