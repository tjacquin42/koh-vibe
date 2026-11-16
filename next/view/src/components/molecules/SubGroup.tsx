import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Icon } from '../atoms/Icon';

/**
 * A group inside a folder, set a little to the right under a heading that is
 * one icon and a count, no words — the closed conversations, the artifacts
 * (16/11). It folds at its heading; `foldKey` is the key its fold is kept
 * under (ui-state.ts).
 */
export function SubGroup({
  foldKey,
  folded,
  onToggle,
  label,
  marker,
  count,
  headProps,
  children,
}: {
  foldKey: string;
  folded: boolean;
  onToggle(): void;
  /** What the heading is, for a screen reader and the tip: it shows no word. */
  label: string;
  marker: ReactNode;
  count: number;
  /** `data-flip-*`: what hooks/useFlip.ts folds rows into (see there). */
  headProps?: ButtonHTMLAttributes<HTMLButtonElement> & { 'data-flip'?: string; 'data-flip-parent'?: string; 'data-flip-anchor'?: string; 'data-flip-folded'?: string; 'data-flip-holds'?: string };
  children: ReactNode;
}) {
  return (
    <div className="sub-group">
      <button type="button" className="sub-head" data-fold={foldKey} aria-expanded={!folded} aria-label={label} onClick={onToggle} {...headProps}>
        <Icon name={folded ? 'chevR' : 'chev'} />
        {marker}
        <span className="n">{count}</span>
      </button>
      {!folded && children}
    </div>
  );
}
