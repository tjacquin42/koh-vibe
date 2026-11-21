/**
 * Bringing a row into sight once the list has stopped moving (21/11).
 *
 * `scrollIntoView` measured the row while it still slid in (hooks/useFlip.ts)
 * and while its folder's height still glided open: the list scrolled to where
 * the row was mid-flight, and it came to rest half under the list's top edge,
 * or past its foot. Waiting for those animations, then measuring, lands it
 * whole.
 */

/** Room kept between a revealed row and the edge of the list. */
export const REVEAL_MARGIN = 8;
/** The longest a reveal waits on the list's animations. */
const SETTLE_CAP_MS = 900;

export interface Span {
  top: number;
  bottom: number;
}

/**
 * The scroll position that shows `row` whole inside `view`, nearest move
 * first — or undefined when it already shows. A row taller than the view
 * shows its top.
 */
export function revealScroll(row: Span, view: Span, scrollTop: number, margin = REVEAL_MARGIN): number | undefined {
  const top = view.top + margin;
  const bottom = view.bottom - margin;
  if (row.top >= top && row.bottom <= bottom) return undefined;
  if (row.top < top || row.bottom - row.top > bottom - top) return Math.max(0, scrollTop + row.top - top);
  return scrollTop + row.bottom - bottom;
}

/** Whether an animation ends: a pulsing dot or a spinner never does, and is not waited on. */
function ends(a: Animation): boolean {
  const end = a.effect?.getComputedTiming().endTime;
  return typeof end === 'number' && Number.isFinite(end);
}

/** Resolves once the animations under `el` that end have ended, or after `capMs`. */
export async function settled(el: Element, capMs = SETTLE_CAP_MS): Promise<void> {
  const running = typeof el.getAnimations === 'function' ? el.getAnimations({ subtree: true }).filter(ends) : [];
  if (running.length === 0) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    Promise.allSettled(running.map((a) => a.finished)),
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, capMs);
    }),
  ]);
  clearTimeout(timer);
}

/** The nearest ancestor that scrolls vertically. */
export function scrollerOf(el: Element): HTMLElement | undefined {
  for (let p = el.parentElement; p !== null; p = p.parentElement) {
    const y = getComputedStyle(p).overflowY;
    if (y === 'auto' || y === 'scroll') return p;
  }
  return undefined;
}

/** Waits for the list under `root` to settle, then scrolls `row` whole into sight. */
export async function revealRow(root: Element, row: Element, smooth: boolean): Promise<void> {
  await settled(root);
  if (!row.isConnected) return;
  const scroller = scrollerOf(row);
  if (scroller === undefined) return;
  const to = revealScroll(row.getBoundingClientRect(), scroller.getBoundingClientRect(), scroller.scrollTop);
  if (to !== undefined) scroller.scrollTo({ top: to, behavior: smooth ? 'smooth' : 'auto' });
}
