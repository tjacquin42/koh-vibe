import { useEffect, useState, type CSSProperties } from 'react';

/**
 * What an icon is, said shortly after the pointer rests on it (14/11): any
 * element with `data-tip`, and every icon-only button by its aria-label. One bubble for the page, placed against the window
 * under the element — above when there is no room — and gone at the first
 * move away, press, key or scroll. Quicker than the browser's own tooltip,
 * which waits a long second.
 */
const DELAY_MS = 350;
const TIPPED = '[data-tip], .ibtn[aria-label], .tbtn[aria-label], .fchip[aria-label]';
const textOf = (el: Element): string | null => el.getAttribute('data-tip') ?? el.getAttribute('aria-label');
const GAP = 6;

export function TipLayer() {
  const [tip, setTip] = useState<{ text: string; style: CSSProperties } | undefined>();
  useEffect(() => {
    let timer: number | undefined;
    let current: Element | null = null;
    const hide = (): void => {
      window.clearTimeout(timer);
      current = null;
      setTip(undefined);
    };
    const over = (e: PointerEvent): void => {
      const el = (e.target as Element | null)?.closest(TIPPED) ?? null;
      if (el === current) return;
      hide();
      if (el === null) return;
      current = el;
      timer = window.setTimeout(() => {
        const text = textOf(el);
        if (text === null || text === '' || !el.isConnected) return;
        const r = el.getBoundingClientRect();
        const below = r.bottom + GAP + 28 < window.innerHeight;
        const x = Math.min(Math.max(r.left + r.width / 2, 40), window.innerWidth - 40);
        setTip({ text, style: below ? { top: r.bottom + GAP, left: x } : { bottom: window.innerHeight - r.top + GAP, left: x } });
      }, DELAY_MS);
    };
    document.addEventListener('pointerover', over);
    document.addEventListener('pointerdown', hide, true);
    document.addEventListener('keydown', hide, true);
    document.addEventListener('scroll', hide, true);
    document.addEventListener('pointerleave', hide);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('pointerover', over);
      document.removeEventListener('pointerdown', hide, true);
      document.removeEventListener('keydown', hide, true);
      document.removeEventListener('scroll', hide, true);
      document.removeEventListener('pointerleave', hide);
    };
  }, []);
  return tip === undefined ? null : (
    <div className="tip" role="tooltip" style={tip.style}>
      {tip.text}
    </div>
  );
}
