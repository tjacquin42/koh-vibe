import { useLayoutEffect, useRef, type RefObject } from 'react';

/**
 * Rows that move where they belong, « physically » (14/11): a conversation
 * that closes slides down to the closed ones, one filed in a folder slides
 * into it. Folding a section draws its rows up into its heading, where they
 * vanish; unfolding lets them out of it, down to their places — and every
 * other coming and going does the same, by the same heading.
 *
 * FLIP: after each render, every `[data-flip="<id>"]` under `root` is
 * measured; one that was elsewhere a render ago is put back there with a
 * transform and let go — the browser animates the way home. One that is
 * gone is re-inserted as a ghost at its last place and animated out.
 * Positions are taken in the scroll container's own coordinates, so
 * scrolling between two renders is not mistaken for a move.
 *
 * A row names its sections, nearest first (`data-flip-parent`, space
 * separated: a sleeping row names its group, then its folder); a heading
 * names itself (`data-flip-anchor`) and says whether it is folded
 * (`data-flip-folded`). A row goes into, and comes out of, the nearest of its
 * headings still on screen — the folder's when folding it took the group's
 * heading away with it.
 *
 * Off with the Animations setting, and with the system's reduced motion.
 * Rows out of sight are not animated; a burst of unrelated arrivals or
 * departures (a tab opened) just appears or vanishes.
 */
const BURST = 12;
const MOVE_MS = 320;
const FOLD_MS = 240;

interface Spot {
  top: number;
  left: number;
  width: number;
  height: number;
  el: HTMLElement;
  /** Its sections, nearest first: a sleeping row names its group, then its folder. */
  parents: string[];
}

interface Anchor {
  top: number;
  folded: boolean;
}

export function useFlip(root: RefObject<HTMLElement | null>, enabled: boolean): void {
  const prev = useRef<{ rows: Map<string, Spot>; anchors: Map<string, Anchor> } | undefined>(undefined);
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
      const parents = (node.dataset['flipParent'] ?? '').split(' ').filter((p) => p.length > 0);
      rows.set(id, { top: topOf(r), left: r.left - base.left, width: r.width, height: r.height, el: node, parents });
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
    // The first render has nothing to move from — and with every folder folded
    // it may hold no row at all, which must not pass for « first » later on.
    if (before === undefined || !enabled || reduced || typeof el.animate !== 'function') return;

    // What a fold or an unfold touches is in sight or near it; the rest needs no show.
    const viewTop = scroller.scrollTop - 200;
    const viewBottom = scroller.scrollTop + scroller.clientHeight + 200;
    const inSight = (top: number): boolean => top >= viewTop && top <= viewBottom;
    // Whether one of a row's sections just folded or opened — its own group,
    // or the folder around it, which takes the group with it.
    const justFolded = (parents: readonly string[]): boolean =>
      parents.some((p) => anchors.get(p)?.folded === true && before.anchors.get(p)?.folded === false);
    const justOpened = (parents: readonly string[]): boolean =>
      parents.some((p) => anchors.get(p)?.folded === false && before.anchors.get(p)?.folded === true);
    // Where a row goes into or comes out of: the outermost of its sections
    // that just folded or opened — a folder taking its group with it moves
    // everything through its own heading — else the nearest still on screen.
    const headingOf = (parents: readonly string[]): Anchor | undefined => {
      const changed = [...parents].reverse().find((p) => {
        const now = anchors.get(p);
        const was = before.anchors.get(p);
        return now !== undefined && was !== undefined && now.folded !== was.folded;
      });
      if (changed !== undefined) return anchors.get(changed);
      for (const p of parents) {
        const a = anchors.get(p);
        if (a !== undefined) return a;
      }
      return undefined;
    };

    for (const [id, spot] of rows) {
      const was = before.rows.get(id);
      if (was === undefined) continue;
      const dx = was.left - spot.left;
      const dy = was.top - spot.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
      spot.el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: MOVE_MS, easing: 'cubic-bezier(.2,.8,.2,1)' });
    }

    // One motion for every coming and going (14/11): a row leaves by going up
    // into its section's heading and vanishing there — the fold's motion —
    // and arrives by coming out of it. A row whose section has no heading
    // left (a folder deleted) folds where it stands.
    const arrived = [...rows].filter(([id]) => !before.rows.has(id));
    const loose = arrived.filter(([, s]) => !justOpened(s.parents));
    for (const [, spot] of arrived) {
      if (!inSight(spot.top)) continue;
      if (!justOpened(spot.parents) && loose.length > BURST) continue;
      const from = headingOf(spot.parents);
      const start = from === undefined ? 'scaleY(0.4)' : `translateY(${from.top - spot.top}px) scaleY(0.6)`;
      spot.el.animate([{ opacity: 0, transform: start, transformOrigin: 'top center' }, { opacity: 1, transform: 'none', transformOrigin: 'top center' }], {
        duration: FOLD_MS,
        easing: 'cubic-bezier(.2,.8,.2,1)',
      });
    }

    const gone = [...before.rows].filter(([id]) => !rows.has(id));
    const leaving = gone.filter(([, s]) => !justFolded(s.parents));
    for (const [, was] of gone) {
      if (!inSight(was.top)) continue;
      if (!justFolded(was.parents) && leaving.length > BURST) continue;
      const into = headingOf(was.parents);
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
      const end = into === undefined ? 'scaleY(0.2)' : `translateY(${into.top - was.top}px) scaleY(0.6)`;
      const out = ghost.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: end }], { duration: FOLD_MS, easing: 'cubic-bezier(.4,0,.6,1)' });
      out.onfinish = () => ghost.remove();
    }
  });
}
