/**
 * An order the user arranges by dragging (14/11, « personnalisable, avec pas
 * mal de drag & drop »): the sidebar's tabs, the cockpit's views.
 *
 * A saved order is read against the full list: unknown ids are dropped,
 * doubles kept once, and anything missing — a tab added by an update — goes
 * at the end, so a stale order never hides anything.
 */
export function normalizeOrder<T extends string>(raw: unknown, all: readonly T[]): T[] {
  const seen = new Set<T>();
  if (Array.isArray(raw)) for (const x of raw) if ((all as readonly unknown[]).includes(x)) seen.add(x as T);
  for (const x of all) seen.add(x);
  return [...seen];
}

/** `id` moved in front of `before`, or to the end. */
export function moveBefore<T>(order: readonly T[], id: T, before: T | undefined): T[] {
  const rest = order.filter((x) => x !== id);
  const at = before === undefined ? -1 : rest.indexOf(before);
  return at < 0 ? [...rest, id] : [...rest.slice(0, at), id, ...rest.slice(at)];
}
