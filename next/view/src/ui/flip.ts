import { useLayoutEffect, useRef, type RefObject } from 'react';

/**
 * Rows that move where they belong, « physically » (14/11): a conversation
 * that closes slides down to the closed ones, one filed in a folder slides
 * into it, one that leaves the list slides out, one that arrives fades in.
 *
 * FLIP: after each render, every `[data-flip="<id>"]` under `root` is
 * measured; one that was elsewhere a render ago is put back there with a
 * transform and let go — the browser animates the way home. One that is
 * gone is re-inserted as a ghost at its last place and slides out. Positions
 * are taken in the scroll container's own coordinates, so scrolling between
 * two renders is not mistaken for a move.
 *
 * Off with the Animations setting, and with the system's reduced motion. A
 * burst (a folder unfolded, a tab opened) is not animated row by row: past a
 * dozen arrivals or departures at once, they just appear or vanish.
 */
const BURST = 12;
const MOVE_MS = 320;
const IN_MS = 220;
const OUT_MS = 260;

interface Spot {
  top: number;
  left: number;
  width: number;
  height: number;
  el: HTMLElement;
}

export function useFlip(root: RefObject<HTMLElement | null>, enabled: boolean): void {
  const prev = useRef<Map<string, Spot>>(new Map());
  useLayoutEffect(() => {
    const el = root.current;
    if (el === null) return;
    const scroller = el.closest<HTMLElement>('.body') ?? el;
    const base = scroller.getBoundingClientRect();
    const now = new Map<string, Spot>();
    for (const node of el.querySelectorAll<HTMLElement>('[data-flip]')) {
      const id = node.dataset['flip'];
      if (id === undefined) continue;
      const r = node.getBoundingClientRect();
      now.set(id, { top: r.top - base.top + scroller.scrollTop, left: r.left - base.left, width: r.width, height: r.height, el: node });
    }
    const before = prev.current;
    prev.current = now;
    const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!enabled || reduced || before.size === 0 || typeof el.animate !== 'function') return;

    const arrived = [...now].filter(([id]) => !before.has(id));
    const gone = [...before].filter(([id]) => !now.has(id));
    for (const [id, spot] of now) {
      const was = before.get(id);
      if (was === undefined) continue;
      const dx = was.left - spot.left;
      const dy = was.top - spot.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
      spot.el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: MOVE_MS, easing: 'cubic-bezier(.2,.8,.2,1)' });
    }
    if (arrived.length <= BURST) {
      for (const [, spot] of arrived) {
        spot.el.animate([{ opacity: 0, transform: 'translateY(-6px)' }, { opacity: 1, transform: 'none' }], { duration: IN_MS, easing: 'ease-out' });
      }
    }
    if (gone.length <= BURST) {
      for (const [, was] of gone) {
        // The old node is detached by now; a copy of it stands where it was, then slides out.
        const ghost = was.el.cloneNode(true) as HTMLElement;
        ghost.removeAttribute('data-flip');
        ghost.setAttribute('aria-hidden', 'true');
        Object.assign(ghost.style, {
          position: 'absolute',
          top: `${was.top}px`,
          left: `${was.left}px`,
          width: `${was.width}px`,
          height: `${was.height}px`,
          margin: '0',
          pointerEvents: 'none',
        });
        scroller.appendChild(ghost);
        const out = ghost.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateX(28px)' }], { duration: OUT_MS, easing: 'ease-in' });
        out.onfinish = () => ghost.remove();
      }
    }
  });
}
