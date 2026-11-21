import { useCallback, useLayoutEffect, useRef, useState } from 'react';

/**
 * The sections of a view as macOS moves between its spaces with three fingers
 * (21/11): the section follows the fingers, then the next one pushes it out,
 * the two side by side with a gap between them, eased to a stop. At either
 * end the section gives a little and springs back.
 *
 * The sections just left stay mounted, hidden, for a few changes more: a
 * trackpad gesture keeps sending its wheel events to the element it began on,
 * and one taken out of the page sent them nowhere — the next swipe did
 * nothing until a click (21/11).
 *
 * A change made while the last push still runs goes on from where the
 * sections are (21/11): the one coming in turns around and leaves from there,
 * the next one beside it, and the one before rides out along with it — or
 * goes at once if it is the one coming back.
 */

/** The space between two sections while one pushes the other. */
export const PANE_GAP = 16;
const PUSH_MS = 460;
const BACK_MS = 320;
const EASE = 'cubic-bezier(.22, 1, .36, 1)';
/** How many sections left stay mounted. */
const TRAIL = 3;

/** How far the section follows the fingers: all the way, or not at all toward an end. */
export function pullOffset(dx: number, ends: boolean): number {
  return ends ? 0 : dx;
}

/** The two ends of a push: where each section starts and ends, from the fingers' offset. */
export function pushFrames(dir: 1 | -1, offset: number): { leaving: [string, string]; entering: [string, string] } {
  const out = dir === 1 ? `calc(-100% - ${PANE_GAP}px)` : `calc(100% + ${PANE_GAP}px)`;
  const from = dir === 1 ? `calc(100% + ${PANE_GAP - offset}px)` : `calc(-100% - ${PANE_GAP + offset}px)`;
  return { leaving: [`translateX(${-offset}px)`, `translateX(${out})`], entering: [`translateX(${from})`, 'translateX(0px)'] };
}

/**
 * A section still on its way out when the next push starts: it rides along with
 * the one now leaving, `rel` pixels from it, so the two never overlap.
 */
export function rideFrames(dir: 1 | -1, at: number, rel: number): [string, string] {
  const out = dir === 1 ? `-100% - ${PANE_GAP}px` : `100% + ${PANE_GAP}px`;
  return [`translateX(${at}px)`, `translateX(calc(${out} + ${rel}px))`];
}

/** A section drawn: its key, and which drawing of it — one shown again is drawn afresh. */
export interface Pane<T extends string> {
  key: T;
  id: string;
}

export interface Panes<T extends string> {
  /** What to draw: the ones left (each hidden once it is out), then the current one. */
  panes: readonly Pane<T>[];
  props(pane: Pane<T>): { ref(el: HTMLElement | null): void; className: string; 'aria-hidden'?: true; tabIndex: -1 };
  /** The fingers' offset during a gesture; `ends` when there is nothing that way — it then stays put. */
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
  const [trail, setTrail] = useState<readonly Pane<T>[]>([]);
  const [gone, setGone] = useState<ReadonlySet<string>>(() => new Set());
  const els = useRef(new Map<string, HTMLElement>());
  const offset = useRef(0);
  const pending = useRef<{ to: T; dir: 1 | -1; offset: number; focus: boolean } | undefined>(undefined);

  const drag = useCallback(
    (dx: number, ends: boolean) => {
      const pane = els.current.get(cur.id);
      if (pane === undefined || !animate) return;
      // Still coming in from the last change: it carries on, and the next push starts from where it is.
      if (pane.getAnimations().some((a) => a.playState === 'running')) return;
      offset.current = pullOffset(dx, ends);
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
      const kept = [...trail.filter((p) => p.id !== cur.id), cur].slice(-TRAIL);
      setTrail(kept);
      setGone((g) => new Set([...g].filter((id) => kept.some((p) => p.id === id))));
    },
    [cur, trail],
  );

  useLayoutEffect(() => {
    const p = pending.current;
    pending.current = undefined;
    // Changed from elsewhere (a reload, the host): nothing to push from.
    if (p === undefined || p.to !== cur.key) {
      setTrail([]);
      return;
    }
    const left = trail.at(-1);
    const entering = els.current.get(cur.id);
    const leaving = left === undefined ? undefined : els.current.get(left.id);
    if (p.focus) entering?.focus({ preventScroll: true });
    if (!animate || left === undefined || entering === undefined || leaving === undefined || typeof entering.animate !== 'function') {
      if (leaving !== undefined) leaving.style.transform = '';
      setGone(new Set(trail.map((t) => t.id)));
      return;
    }
    const opts = { duration: PUSH_MS, easing: EASE };
    const running = (el: HTMLElement): boolean => el.getAnimations().some((a) => a.playState === 'running');
    const x = (el: HTMLElement): number => new DOMMatrixReadOnly(getComputedStyle(el).transform).m41;
    // Stopped to be sent on again: its old end must not hide it.
    const stop = (el: HTMLElement): void =>
      el.getAnimations().forEach((a) => {
        a.onfinish = null;
        a.oncancel = null;
        a.cancel();
      });
    const send = (pane: Pane<T>, el: HTMLElement, frames: readonly [string, string]): void => {
      stop(el);
      el.style.transform = '';
      const hide = (): void => setGone((g) => new Set(g).add(pane.id));
      const run = el.animate([{ transform: frames[0] }, { transform: frames[1] }], { ...opts, fill: 'forwards' });
      run.onfinish = hide;
      run.oncancel = hide;
    };
    // Caught in the last push: it leaves from where it got to, not from its place.
    const at = running(leaving) ? x(leaving) : -p.offset;
    for (const pane of trail.slice(0, -1)) {
      const el = els.current.get(pane.id);
      if (el === undefined || !running(el)) continue;
      if (pane.key === cur.key) {
        stop(el);
        setGone((g) => new Set(g).add(pane.id));
      } else send(pane, el, rideFrames(p.dir, x(el), x(el) - at));
    }
    const f = pushFrames(p.dir, -at);
    send(left, leaving, f.leaving);
    entering.animate([{ transform: f.entering[0] }, { transform: f.entering[1] }], opts);
  }, [cur.id]);

  const panes = [...trail.filter((p) => p.id !== cur.id), cur];
  return {
    panes,
    props: (pane) => {
      const leaving = pane.id !== cur.id;
      return {
        ref: (node) => {
          if (node === null) els.current.delete(pane.id);
          else els.current.set(pane.id, node);
        },
        className: leaving ? (gone.has(pane.id) ? 'pane pane-left pane-gone' : 'pane pane-left') : 'pane',
        tabIndex: -1,
        ...(leaving ? { 'aria-hidden': true as const } : {}),
      };
    },
    drag,
    release,
    go,
  };
}
