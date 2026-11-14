import type { HTMLAttributes, ReactNode } from 'react';
import { Icon } from './icons';

/**
 * A foldable heading and what it holds. The fold is remembered by the view
 * (ui-state.ts) under `foldKey`; without one the section cannot fold.
 *
 * `tools` sit at the right of the heading, outside the fold button; `title`
 * may be replaced by an input while renaming. `sectionProps` and `headProps`
 * carry drag and drop: a whole section takes a dropped conversation, a
 * heading is what a folder is dragged by.
 */
export function Section({
  title,
  count,
  marker,
  folded,
  onToggle,
  tools,
  className,
  sectionProps,
  headProps,
  children,
}: {
  title: ReactNode;
  count?: number;
  marker?: ReactNode;
  folded?: boolean;
  onToggle?: () => void;
  tools?: ReactNode;
  className?: string;
  sectionProps?: HTMLAttributes<HTMLElement>;
  /** `data-flip-*`: what ui/flip.ts folds rows into (see there). */
  headProps?: HTMLAttributes<HTMLHeadingElement> & { draggable?: boolean; 'data-flip-anchor'?: string; 'data-flip-folded'?: string };
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
    <section className={className === undefined ? 'group' : `group ${className}`} {...sectionProps}>
      <h2 className="sec" {...headProps}>
        {onToggle === undefined ? (
          head
        ) : (
          <button type="button" className="sec-btn" aria-expanded={folded !== true} onClick={onToggle}>
            {head}
          </button>
        )}
        {tools !== undefined && <span className="sec-tools">{tools}</span>}
      </h2>
      {folded !== true && children}
    </section>
  );
}
