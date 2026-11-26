import { useLayoutEffect, useState, type RefObject } from 'react';

/**
 * Whether a bar of tabs shows icons only (15/11): when a name would not fit —
 * never a name cut short with « … ».
 *
 * Each tab says its name in `data-name`, shown or not. Whether it fits is
 * worked out from the tab's own width — the tabs share the bar evenly, names
 * or icons — and the name's width in the tab's font, measured apart from
 * the page. The answer so does not depend on what is shown at the moment:
 * no flicker at the edge, and nothing to miss when the fonts load late or
 * the words change.
 */
export function useIconsOnly(bar: RefObject<HTMLElement | null>): boolean {
  const [narrow, setNarrow] = useState(false);
  useLayoutEffect(() => {
    const el = bar.current;
    if (el === null) return undefined;
    const check = (): void => setNarrow(!namesFit(el));
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    // A tab added, moved or renamed (a language changed).
    const mo = new MutationObserver(check);
    mo.observe(el, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-name'] });
    const fonts = typeof document !== 'undefined' ? document.fonts : undefined;
    fonts?.addEventListener('loadingdone', check);
    void fonts?.ready.then(check);
    return () => {
      ro.disconnect();
      mo.disconnect();
      fonts?.removeEventListener('loadingdone', check);
    };
  }, [bar]);
  return narrow;
}

/** One measuring surface for the whole page. */
let measurer: CanvasRenderingContext2D | null | undefined;

/** Whether every tab of the bar has room for its icon and its whole name. */
function namesFit(bar: HTMLElement): boolean {
  measurer ??= typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d');
  if (measurer === null) return true;
  for (const tab of bar.querySelectorAll<HTMLElement>('[data-name]')) {
    const css = getComputedStyle(tab);
    measurer.font = `${css.fontWeight} ${css.fontSize} ${css.fontFamily}`;
    const text = measurer.measureText(tab.dataset['name'] ?? '').width;
    const icon = tab.querySelector('.icon')?.getBoundingClientRect().width ?? 0;
    const gap = parseFloat(css.columnGap) || 0;
    const room = tab.clientWidth - (parseFloat(css.paddingLeft) || 0) - (parseFloat(css.paddingRight) || 0);
    // A pixel kept in hand: the canvas and the page round text a hair apart.
    if (icon + gap + text + 1 > room) return false;
  }
  return true;
}
