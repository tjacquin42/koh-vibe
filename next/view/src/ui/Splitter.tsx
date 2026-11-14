import { useRef, type RefObject } from 'react';

/**
 * A separator the user drags to give one side more room (14/11).
 *
 * It sizes `target` — the panel on one side of it — through a CSS variable on
 * `container`, set directly while the pointer moves (no React render per
 * pixel), then remembered once let go. `invert` when the panel sits after the
 * handle (to its right, or below): dragging toward the panel shrinks it.
 * Double-click gives the layout its own size back; the arrow keys move it by
 * 16 px for whoever does not use a mouse.
 */
export function Splitter({
  axis,
  target,
  container,
  cssVar,
  invert = false,
  min = 120,
  max = 900,
  label,
  className,
  onCommit,
}: {
  axis: 'x' | 'y';
  target: RefObject<HTMLElement | null>;
  container: RefObject<HTMLElement | null>;
  cssVar: string;
  invert?: boolean;
  min?: number;
  max?: number;
  label: string;
  className?: string;
  /** The size let go at, or `undefined` to go back to the layout's own. */
  onCommit(px: number | undefined): void;
}) {
  const drag = useRef<{ start: number; size: number; last: number } | undefined>(undefined);
  const clamp = (v: number): number => Math.max(min, Math.min(max, v));
  const sizeOf = (): number => {
    const r = target.current?.getBoundingClientRect();
    return r === undefined ? min : axis === 'x' ? r.width : r.height;
  };
  const apply = (px: number): void => container.current?.style.setProperty(cssVar, `${px}px`);
  return (
    <div
      role="separator"
      aria-orientation={axis === 'x' ? 'vertical' : 'horizontal'}
      aria-label={label}
      tabIndex={0}
      className={`splitter splitter-${axis}${className === undefined ? '' : ` ${className}`}`}
      onPointerDown={(e) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        const size = sizeOf();
        drag.current = { start: axis === 'x' ? e.clientX : e.clientY, size, last: size };
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (d === undefined) return;
        const delta = (axis === 'x' ? e.clientX : e.clientY) - d.start;
        d.last = clamp(d.size + (invert ? -delta : delta));
        apply(d.last);
      }}
      onPointerUp={(e) => {
        const d = drag.current;
        drag.current = undefined;
        e.currentTarget.releasePointerCapture(e.pointerId);
        if (d !== undefined && d.last !== d.size) onCommit(d.last);
      }}
      onDoubleClick={() => {
        container.current?.style.removeProperty(cssVar);
        onCommit(undefined);
      }}
      onKeyDown={(e) => {
        const step = { ArrowLeft: -16, ArrowUp: -16, ArrowRight: 16, ArrowDown: 16 }[e.key];
        if (step === undefined) return;
        e.preventDefault();
        const next = clamp(sizeOf() + (invert ? -step : step));
        apply(next);
        onCommit(next);
      }}
    />
  );
}
