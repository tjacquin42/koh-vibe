import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';

/**
 * A small window floating by the button that opened it, over whatever is
 * there — it moves nothing (14/11). It belongs to the row of that button, so a
 * folder's shows whether the folder is folded or not.
 *
 * Placed against the window, not the list: the list scrolls and would cut it.
 * It opens under the button, or above when there is more room there, never
 * past the window's edge (it scrolls inside if it must). A click elsewhere,
 * Escape, or the list scrolling away from its row closes it.
 */
const GAP = 4;
const MARGIN = 8;

/** A point instead of a button: a right-click opens there (21/11). */
export interface Point {
  x: number;
  y: number;
}

/**
 * Where a box `width` × `height` opened at `at` goes: right and down from the
 * point, or left / up when the window has more room that way — always inside
 * it, scrolling inside if it must.
 */
export function placeAt(at: Point, width: number, height: number, win: { width: number; height: number }): CSSProperties {
  const below = win.height - at.y - MARGIN;
  const above = at.y - MARGIN;
  const down = height <= below || below >= above;
  const left = at.x + width <= win.width - MARGIN ? at.x : Math.max(MARGIN, at.x - width);
  return down
    ? { top: at.y, left, maxHeight: below, transformOrigin: 'top left' }
    : { bottom: win.height - at.y, left, maxHeight: above, transformOrigin: 'bottom left' };
}

export function Popover({ label, onClose, at, role = 'dialog', children }: { label: string; onClose(): void; at?: Point; role?: 'dialog' | 'menu'; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<CSSProperties>({ visibility: 'hidden' });
  useLayoutEffect(() => {
    const el = box.current;
    if (el !== null && at !== undefined) {
      setPlace(placeAt(at, el.offsetWidth, el.scrollHeight, { width: window.innerWidth, height: window.innerHeight }));
      return;
    }
    const anchor = el?.parentElement?.getBoundingClientRect();
    if (el === null || anchor === undefined) return;
    const h = window.innerHeight;
    const below = h - anchor.bottom - GAP - MARGIN;
    const above = anchor.top - GAP - MARGIN;
    const height = el.scrollHeight;
    // Right-aligned on its button, but never past the window's left edge either (15/11).
    // Its layout width: the opening animation scales it down a little, and a width read
    // through it left the box a few pixels past the window's left edge (21/11).
    const width = el.offsetWidth;
    const right = Math.min(Math.max(MARGIN, window.innerWidth - anchor.right), Math.max(MARGIN, window.innerWidth - MARGIN - width));
    setPlace(
      height <= below || below >= above
        ? { top: anchor.bottom + GAP, right, maxHeight: below }
        : { bottom: h - anchor.top + GAP, right, maxHeight: above, transformOrigin: 'bottom right' },
    );
  }, [at]);
  useEffect(() => {
    const away = (e: PointerEvent): void => {
      const el = box.current;
      // The button that opened it toggles it itself: a press on it is not « elsewhere ».
      const opener = at === undefined ? el?.parentElement?.querySelector('[aria-expanded="true"]') : undefined;
      if (el !== null && !el.contains(e.target as Node) && !(opener?.contains(e.target as Node) ?? false)) onClose();
    };
    const key = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    // Fixed to the window, it would stay put while its row scrolls away.
    const scrolled = (e: Event): void => {
      if (!(box.current?.contains(e.target as Node) ?? false)) onClose();
    };
    // A right-click menu: the editor took the focus, or the window changed size —
    // it closes, as a native one does. A box one types in stays open.
    const gone = (): void => {
      if (at !== undefined) onClose();
    };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', key);
    document.addEventListener('scroll', scrolled, true);
    window.addEventListener('blur', gone);
    window.addEventListener('resize', gone);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', key);
      document.removeEventListener('scroll', scrolled, true);
      window.removeEventListener('blur', gone);
      window.removeEventListener('resize', gone);
    };
  }, [onClose, at]);
  return (
    <div ref={box} className={at === undefined ? 'popover' : 'popover at-point'} role={role} aria-label={label} style={place}>
      {children}
    </div>
  );
}
