import { useLayoutEffect, useRef, type RefObject } from 'react';

/**
 * Rows that move where they belong, « physically » (14/11): a conversation
 * that closes slides down to the closed ones, one filed in a folder slides
 * into it, one that leaves the list slides out, one that arrives fades in.
 * Folding a section draws its rows up into its heading, where they vanish;
 * unfolding lets them out of it, down to their places.
 *
 * FLIP: after each render, every `[data-flip="<id>"]` under `root` is
 * measured; one that was elsewhere a render ago is put back there with a
 * transform and let go — the browser animates the way home. One that is
 * gone is re-inserted as a ghost at its last place and animated out.
 * Positions are taken in the scroll container's own coordinates, so
 * scrolling between two renders is not mistaken for a move.
 *
 * Folding is told apart from leaving by the headings: a row names its
 * section (`data-flip-parent`), a heading names itself (`data-flip-anchor`)
 * and says whether it is folded (`data-flip-folded`). A row gone because its
 * heading just folded goes up into it; a row back because it just unfolded
 * comes out of it.
 *
 * Off with the Animations setting, and with the system's reduced motion.
 * Rows out of sight are not animated; a burst of unrelated arrivals or
 * departures (a tab opened) just appears or vanishes.
 */
const BURST = 12;
const MOVE_MS = 320;
const IN_MS = 220;
const OUT_MS = 260;
const FOLD_MS = 240;

interface Spot {
  top: number;
  left: number;
  width: number;
  height: number;
  el: HTMLElement;
  parent?: string;
}

interface Anchor {
  top: number;
  folded: boolean;
}

export function useFlip(root: RefObject<HTMLElement | null>, enabled: boolean): void {
  const prev = useRef<{ rows: Map<string, Spot>; anchors: Map<string, Anchor> }>({ rows: new Map(), anchors: new Map() });
  useLayoutEffect(() => {
    const el = root.current;
    if (el === null) return;
    const scroller = el.closest<HTMLElement>('.body') ?? el;
    const base = scroller.getBoundingClientRect();
    const topOf = (r: DOMRect): number => r.top - base.top + scroller.scrollTop;
    const rows = new Map<string, Spot>();
    for (const node of el.querySelectorAll<HTMLElement>('[data-flip]')) {
      const id = node.dataset['flip'];
      if (id === undefined) continue;
      const r = node.getBoundingClientRect();
      const spot: Spot = { top: topOf(r), left: r.left - base.left, width: r.width, height: r.height, el: node };
      const parent = node.dataset['flipParent'];
      if (parent !== undefined) spot.parent = parent;
      rows.set(id, spot);
    }
    const anchors = new Map<string, Anchor>();
    for (const node of el.querySelectorAll<HTMLElement>('[data-flip-anchor]')) {
      const key = node.dataset['flipAnchor'];
      if (key === undefined) continue;
      anchors.set(key, { top: topOf(node.getBoundingClientRect()), folded: node.dataset['flipFolded'] === 'true' });
    }
    const before = prev.current;
    prev.current = { rows, anchors };
    const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!enabled || reduced || before.rows.size === 0 || typeof el.animate !== 'function') return;

    // What a fold or an unfold touches is in sight or near it; the rest needs no show.
    const viewTop = scroller.scrollTop - 200;
    const viewBottom = scroller.scrollTop + scroller.clientHeight + 200;
    const inSight = (top: number): boolean => top >= viewTop && top <= viewBottom;
    const justFolded = (parent: string | undefined): Anchor | undefined => {
      if (parent === undefined) return undefined;
      const now = anchors.get(parent);
      return now !== undefined && now.folded && before.anchors.get(parent)?.folded === false ? now : undefined;
    };
    const justOpened = (parent: string | undefined): Anchor | undefined => {
      if (parent === undefined) return undefined;
      const now = anchors.get(parent);
      return now !== undefined && !now.folded && before.anchors.get(parent)?.folded === true ? now : undefined;
    };

    for (const [id, spot] of rows) {
      const was = before.rows.get(id);
      if (was === undefined) continue;
      const dx = was.left - spot.left;
      const dy = was.top - spot.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
      spot.el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: MOVE_MS, easing: 'cubic-bezier(.2,.8,.2,1)' });
    }

    const arrived = [...rows].filter(([id]) => !before.rows.has(id));
    const loose = arrived.filter(([, s]) => justOpened(s.parent) === undefined);
    for (const [, spot] of arrived) {
      const from = justOpened(spot.parent);
      if (from !== undefined) {
        if (!inSight(spot.top)) continue;
        // Out of the heading, down to its place.
        spot.el.animate(
          [
            { opacity: 0, transform: `translateY(${from.top - spot.top}px) scaleY(0.6)` },
            { opacity: 1, transform: 'none' },
          ],
          { duration: FOLD_MS, easing: 'cubic-bezier(.2,.8,.2,1)' },
        );
      } else if (loose.length <= BURST) {
        spot.el.animate([{ opacity: 0, transform: 'translateY(-6px)' }, { opacity: 1, transform: 'none' }], { duration: IN_MS, easing: 'ease-out' });
      }
    }

    const gone = [...before.rows].filter(([id]) => !rows.has(id));
    const leaving = gone.filter(([, s]) => justFolded(s.parent) === undefined);
    for (const [, was] of gone) {
      const into = justFolded(was.parent);
      if (into === undefined && leaving.length > BURST) continue;
      if (into !== undefined && !inSight(was.top)) continue;
      // The old node is detached by now; a copy of it stands where it was, then goes.
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
        transformOrigin: 'top center',
      });
      scroller.appendChild(ghost);
      const out =
        into !== undefined
          ? // Up into the heading it belongs to, vanishing there.
            ghost.animate(
              [
                { opacity: 1, transform: 'none' },
                { opacity: 0, transform: `translateY(${into.top - was.top}px) scaleY(0.6)` },
              ],
              { duration: FOLD_MS, easing: 'cubic-bezier(.4,0,.6,1)' },
            )
          : ghost.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateX(28px)' }], { duration: OUT_MS, easing: 'ease-in' });
      out.onfinish = () => ghost.remove();
    }
  });
}
