import { useEffect, useRef, type ReactNode } from 'react';

/**
 * A small window floating under the button that opened it, over whatever is
 * below — it moves nothing (14/11). It belongs to the heading row, so it shows
 * whether the section under it is folded or not. A click elsewhere or Escape
 * closes it.
 */
export function Popover({ label, onClose, children }: { label: string; onClose(): void; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
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
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', key);
    };
  }, [onClose]);
  return (
    <div ref={box} className="popover" role="dialog" aria-label={label}>
      {children}
    </div>
  );
}
