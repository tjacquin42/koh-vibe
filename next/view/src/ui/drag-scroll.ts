import { useEffect, type RefObject } from 'react';

/**
 * While something is dragged, the list scrolls when the pointer nears its top
 * or bottom edge — faster the closer it gets — so a conversation at the very
 * bottom can be carried to the very top (14/11). The browser's own
 * autoscroll is too slow and too narrow to count on inside a web view.
 */
const EDGE = 56;
const MAX_STEP = 18;

export function useDragScroll(root: RefObject<HTMLElement | null>, dragging: boolean): void {
  useEffect(() => {
    const el = root.current;
    if (!dragging || el === null) return;
    const scroller = el.closest<HTMLElement>('.body') ?? el;
    let y: number | undefined;
    let frame = 0;
    const onOver = (e: DragEvent): void => {
      y = e.clientY;
    };
    const tick = (): void => {
      if (y !== undefined) {
        const r = scroller.getBoundingClientRect();
        const fromTop = y - r.top;
        const fromBottom = r.bottom - y;
        if (fromTop < EDGE) scroller.scrollTop -= Math.ceil(MAX_STEP * (1 - Math.max(0, fromTop) / EDGE));
        else if (fromBottom < EDGE) scroller.scrollTop += Math.ceil(MAX_STEP * (1 - Math.max(0, fromBottom) / EDGE));
      }
      frame = requestAnimationFrame(tick);
    };
    // On the document: the pointer may leave the list, above it or below, and still be dragging.
    document.addEventListener('dragover', onOver);
    frame = requestAnimationFrame(tick);
    return () => {
      document.removeEventListener('dragover', onOver);
      cancelAnimationFrame(frame);
    };
  }, [root, dragging]);
}
