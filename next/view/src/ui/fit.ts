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
    // The names widen without the bar changing size (15/11): the fonts load
    // after the first measure, a language changes the words. Measured again
    // then, or a name stayed cut — « Sessi… » — instead of the icons alone.
    const mo = new MutationObserver(check);
    mo.observe(el, { childList: true, subtree: true, characterData: true });
    const fonts = typeof document !== 'undefined' ? document.fonts : undefined;
    fonts?.addEventListener('loadingdone', check);
    void fonts?.ready.then(check);
    return () => {
      ro.disconnect();
      mo.disconnect();
      fonts?.removeEventListener('loadingdone', check);
    };
  }, [bar, names]);
  return !names || narrow;
}
