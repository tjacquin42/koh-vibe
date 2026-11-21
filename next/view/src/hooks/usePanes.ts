import { useCallback, useLayoutEffect, useRef, useState } from 'react';

/**
 * The sections of a view as macOS moves between its spaces with three fingers
 * (21/11): the section follows the fingers, then the next one pushes it out,
 * the two side by side with a gap between them, eased to a stop. At either
 * end the section gives a little and springs back.
 *
 * The section just left stays mounted, hidden, until the next change: a
 * trackpad gesture keeps sending its wheel events to the element it began on,
 * and one taken out of the page sent them nowhere — the next swipe did
 * nothing until a click (21/11).
 */

/** The space between two sections while one pushes the other. */
export const PANE_GAP = 16;
const PUSH_MS = 460;
const BACK_MS = 320;
const EASE = 'cubic-bezier(.22, 1, .36, 1)';

/** How far a section gives at either end, for `dx` of fingers: less and less, never past 48 px. */
export function resist(dx: number): number {
  return Math.sign(dx) * 48 * (1 - Math.exp(-Math.abs(dx) / 120));
}

/** The two ends of a push: where each section starts and ends, from the fingers' offset. */
export function pushFrames(dir: 1 | -1, offset: number): { leaving: [string, string]; entering: [string, string] } {
  const out = dir === 1 ? `calc(-100% - ${PANE_GAP}px)` : `calc(100% + ${PANE_GAP}px)`;
  const from = dir === 1 ? `calc(100% + ${PANE_GAP - offset}px)` : `calc(-100% - ${PANE_GAP + offset}px)`;
  return { leaving: [`translateX(${-offset}px)`, `translateX(${out})`], entering: [`translateX(${from})`, 'translateX(0px)'] };
}

/** A section drawn: its key, and which drawing of it — one shown again is drawn afresh. */
export interface Pane<T extends string> {
  key: T;
  id: string;
}

export interface Panes<T extends string> {
  /** What to draw: the one left (hidden once it is out), then the current one. */
  panes: readonly Pane<T>[];
  props(pane: Pane<T>): { ref(el: HTMLElement | null): void; className: string; 'aria-hidden'?: true; tabIndex: -1 };
  /** The fingers' offset during a gesture; `ends` when there is nothing that way. */
  drag(dx: number, ends: boolean): void;
  /** The fingers left before a change: the section springs back. */
  release(): void;
  /** Called before the change to `next`: the push runs once it is drawn. */
  go(next: T, dir: 1 | -1, focus?: boolean): void;
}

export function usePanes<T extends string>(selected: T, animate: boolean): Panes<T> {
  // A section hidden a while measured nothing: shown again, its rows would slide in from
  // the top left corner. The one that comes in is always a new drawing of it.
  const gen = useRef(0);
  const current = useRef<Pane<T>>({ key: selected, id: `${selected}#0` });
  if (current.current.key !== selected) current.current = { key: selected, id: `${selected}#${++gen.current}` };
  const cur = current.current;
  const [left, setLeft] = useState<Pane<T> | undefined>(undefined);
  const [gone, setGone] = useState(false);
  const els = useRef(new Map<string, HTMLElement>());
  const offset = useRef(0);
  const pending = useRef<{ to: T; dir: 1 | -1; offset: number; focus: boolean } | undefined>(undefined);

  const drag = useCallback(
    (dx: number, ends: boolean) => {
      const pane = els.current.get(cur.id);
      if (pane === undefined || !animate) return;
      offset.current = ends ? resist(dx) : dx;
      pane.getAnimations().forEach((a) => a.cancel());
      pane.style.transform = `translateX(${-offset.current}px)`;
    },
    [cur.id, animate],
  );

  const release = useCallback(() => {
    const pane = els.current.get(cur.id);
    const from = offset.current;
    offset.current = 0;
    if (pane === undefined) return;
    pane.style.transform = '';
    if (animate && from !== 0) pane.animate([{ transform: `translateX(${-from}px)` }, { transform: 'translateX(0px)' }], { duration: BACK_MS, easing: EASE });
  }, [cur.id, animate]);

  const go = useCallback(
    (next: T, dir: 1 | -1, focus = false) => {
      if (next === cur.key) return;
      pending.current = { to: next, dir, offset: offset.current, focus };
      offset.current = 0;
      setLeft(cur);
      setGone(false);
    },
    [cur],
  );

  useLayoutEffect(() => {
    const p = pending.current;
    pending.current = undefined;
    // Changed from elsewhere (a reload, the host): nothing to push from.
    if (p === undefined || p.to !== cur.key) {
      setLeft(undefined);
      return;
    }
    const entering = els.current.get(cur.id);
    const leaving = left === undefined ? undefined : els.current.get(left.id);
    if (p.focus) entering?.focus({ preventScroll: true });
    if (leaving !== undefined) leaving.style.transform = '';
    if (!animate || entering === undefined || leaving === undefined || typeof entering.animate !== 'function') {
      setGone(true);
      return;
    }
    const f = pushFrames(p.dir, p.offset);
    const opts = { duration: PUSH_MS, easing: EASE };
    leaving.animate([{ transform: f.leaving[0] }, { transform: f.leaving[1] }], { ...opts, fill: 'forwards' });
    const run = entering.animate([{ transform: f.entering[0] }, { transform: f.entering[1] }], opts);
    run.onfinish = () => setGone(true);
    run.oncancel = () => setGone(true);
  }, [cur.id]);

  const panes = left === undefined || left.id === cur.id ? [cur] : [left, cur];
  return {
    panes,
    props: (pane) => {
      const leaving = pane.id !== cur.id;
      return {
        ref: (node) => {
          if (node === null) els.current.delete(pane.id);
          else els.current.set(pane.id, node);
        },
        className: leaving ? (gone ? 'pane pane-left pane-gone' : 'pane pane-left') : 'pane',
        tabIndex: -1,
        ...(leaving ? { 'aria-hidden': true as const } : {}),
      };
    },
    drag,
    release,
    go,
  };
}
