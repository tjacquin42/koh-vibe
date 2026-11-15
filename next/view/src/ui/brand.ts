/**
 * The sidebar's name, « C2 » (14/11): the logo's colours in horizontal bands
 * through the letters, and the hyphen no character but a lagoon bar laid on
 * the lagoon band (app.css .brand-name, .brand-dash).
 *
 * The rainbow a click sends across it is a layer of the same structure — the
 * same text, the same box where the bar is, but see-through — so its letters
 * fall exactly on the name's.
 */
export type BrandPart = { kind: 'text'; text: string } | { kind: 'dash' };

/** « Koh-Vibe » → Koh, the bar, Vibe. A name with no hyphen is one piece of text. */
export function brandParts(name: string): BrandPart[] {
  const at = name.indexOf('-');
  if (at <= 0 || at === name.length - 1) return [{ kind: 'text', text: name }];
  return [{ kind: 'text', text: name.slice(0, at) }, { kind: 'dash' }, { kind: 'text', text: name.slice(at + 1) }];
}

/** The rainbow's layer, node by node: the text as it is, the bar as an empty box of the same size. */
export function bandNodes(parts: readonly BrandPart[]): ({ text: string } | { className: string })[] {
  return parts.map((p) => (p.kind === 'text' ? { text: p.text } : { className: 'brand-dash brand-dash-ghost' }));
}
