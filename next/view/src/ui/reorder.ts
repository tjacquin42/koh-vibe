import { useRef, useState, type DragEvent } from 'react';
import { moveBefore } from '../order';

/**
 * The drag itself: while it lasts the items show where the dragged one would
 * land (the FLIP slide does the moving), and the drop keeps it. A drag that
 * ends anywhere else puts everything back. Its own drag type: the session
 * list ignores it, and it ignores theirs.
 *
 * The order being shaped lives in a ref as well as in state: a drop can come
 * before the last drag-over has rendered, and must see where it was. The
 * whole bar takes the drop, and a drag that ends over the bar without one
 * keeps its place too: the dragged item slides under the pointer, and the
 * browser can let go over it before it was ever dragged over.
 */
const TYPE = 'application/x-kvn-order';

export function useReorder<T extends string>(order: readonly T[], onChange: (next: T[]) => void) {
  const live = useRef<{ id: T; draft: T[] } | undefined>(undefined);
  const [drag, setDrag] = useState<{ id: T; draft: T[] } | undefined>();
  const set = (next: { id: T; draft: T[] } | undefined): void => {
    live.current = next;
    setDrag(next);
  };
  /** Where the dragged item lands with the pointer over `over`: past its middle, after it, else before. */
  const place = (el: HTMLElement, x: number, over: T): void => {
    const d = live.current;
    if (d === undefined || over === d.id) return;
    // Where the item stands, not where its slide has got to (ui/flip.ts moves it with a transform).
    const r = el.getBoundingClientRect();
    const t = getComputedStyle(el).transform;
    const shift = t === 'none' ? 0 : new DOMMatrixReadOnly(t).m41;
    const rest = d.draft.filter((x) => x !== d.id);
    const before = x > r.left - shift + r.width / 2 ? rest[rest.indexOf(over) + 1] : over;
    const next = moveBefore(d.draft, d.id, before);
    if (next.join() !== d.draft.join()) set({ id: d.id, draft: next });
  };
  const commit = (): void => {
    const d = live.current;
    if (d === undefined) return;
    if (d.draft.join() !== order.join()) onChange(d.draft);
    set(undefined);
  };
  const itemProps = (id: T) => ({
    draggable: true,
    'data-order': id,
    'data-dragging': drag?.id === id ? true : undefined,
    onDragStart: (e: DragEvent) => {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData(TYPE, id);
      set({ id, draft: [...order] });
    },
    onDragOver: (e: DragEvent<HTMLElement>) => {
      if (live.current === undefined) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      place(e.currentTarget, e.clientX, id);
    },
    onDrop: (e: DragEvent<HTMLElement>) => {
      if (live.current === undefined) return;
      e.preventDefault();
      place(e.currentTarget, e.clientX, id);
      commit();
    },
    onDragEnd: (e: DragEvent<HTMLElement>) => {
      const bar = e.currentTarget.parentElement;
      const r = bar?.getBoundingClientRect();
      const inside = r !== undefined && e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
      if (!inside) {
        set(undefined);
        return;
      }
      // Placed against the item under the pointer: the last drag-over may not have come.
      const under = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('[data-order]');
      const over = under?.dataset['order'];
      if (under !== null && under !== undefined && bar?.contains(under) === true && over !== undefined && (order as readonly string[]).includes(over)) {
        place(under, e.clientX, over as T);
      }
      commit();
    },
  });
  /** On the bar holding the items. */
  const barProps = {
    onDragOver: (e: DragEvent) => {
      if (live.current === undefined) return;
      e.preventDefault();
    },
    onDrop: (e: DragEvent) => {
      if (live.current === undefined) return;
      e.preventDefault();
      commit();
    },
  };
  return { shown: drag?.draft ?? order, itemProps, barProps, dragging: drag !== undefined };
}
