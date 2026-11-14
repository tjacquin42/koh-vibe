import { useLayoutEffect, useRef, useState, type RefObject } from 'react';

/**
 * Whether a bar of tabs shows icons only (14/11): when the setting says so,
 * or when the names would be cut. Measured with the names shown; once
 * hidden, they come back only when the bar is wider than where they stopped
 * fitting — no flicker at the edge.
 */
export function useIconsOnly(bar: RefObject<HTMLElement | null>, names: boolean): boolean {
  const [narrow, setNarrow] = useState(false);
  const fitBelow = useRef(0);
  useLayoutEffect(() => {
    const el = bar.current;
    if (el === null || !names) return undefined;
    const check = (): void => {
      const width = el.clientWidth;
      setNarrow((was) => {
        if (was) return width <= fitBelow.current;
        const cut = [...el.querySelectorAll('button > span')].some((s) => s.scrollWidth > s.clientWidth + 1);
        if (cut) fitBelow.current = width;
        return cut;
      });
    };
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [bar, names]);
  return !names || narrow;
}
