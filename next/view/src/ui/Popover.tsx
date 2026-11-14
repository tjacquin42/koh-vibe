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

export function Popover({ label, onClose, children }: { label: string; onClose(): void; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<CSSProperties>({ visibility: 'hidden' });
  useLayoutEffect(() => {
    const el = box.current;
    const anchor = el?.parentElement?.getBoundingClientRect();
    if (el === null || anchor === undefined) return;
    const h = window.innerHeight;
    const below = h - anchor.bottom - GAP - MARGIN;
    const above = anchor.top - GAP - MARGIN;
    const height = el.scrollHeight;
    const right = Math.max(MARGIN, window.innerWidth - anchor.right);
    setPlace(
      height <= below || below >= above
        ? { top: anchor.bottom + GAP, right, maxHeight: below }
        : { bottom: h - anchor.top + GAP, right, maxHeight: above, transformOrigin: 'bottom right' },
    );
  }, []);
  useEffect(() => {
    const away = (e: PointerEvent): void => {
      const el = box.current;
      // The button that opened it toggles it itself: a press on it is not « elsewhere ».
      const opener = el?.parentElement?.querySelector('[aria-expanded="true"]');
      if (el !== null && !el.contains(e.target as Node) && !(opener?.contains(e.target as Node) ?? false)) onClose();
    };
    const key = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    // Fixed to the window, it would stay put while its row scrolls away.
    const scrolled = (e: Event): void => {
      if (!(box.current?.contains(e.target as Node) ?? false)) onClose();
    };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', key);
    document.addEventListener('scroll', scrolled, true);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', key);
      document.removeEventListener('scroll', scrolled, true);
    };
  }, [onClose]);
  return (
    <div ref={box} className="popover" role="dialog" aria-label={label} style={place}>
      {children}
    </div>
  );
}
