import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

/**
 * A row that scrolls sideways with no scrollbar (14/11): a side that still
 * hides something fades out under a blur, and the wheel scrolls it.
 */
export function EdgeScroll({ className, label, children }: { className: string; label: string; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });
  const measure = (): void => {
    const el = box.current;
    if (el === null) return;
    const left = el.scrollLeft > 1;
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
    setEdges((e) => (e.left === left && e.right === right ? e : { left, right }));
  };
  useLayoutEffect(measure);
  useEffect(() => {
    const el = box.current;
    if (el === null) return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    // The wheel turns vertically: sideways here, since nothing else scrolls this row.
    const wheel = (e: WheelEvent): void => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX) || el.scrollWidth <= el.clientWidth) return;
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => {
      ro.disconnect();
      el.removeEventListener('wheel', wheel);
    };
  }, []);
  return (
    <div className={`edge-scroll${edges.left ? ' more-left' : ''}${edges.right ? ' more-right' : ''}`}>
      <div ref={box} className={className} role="radiogroup" aria-label={label} onScroll={measure}>
        {children}
      </div>
    </div>
  );
}
