/**
 * The sidebar's name, « C2 » (14/11, retouched 15/11): the logo's colours in
 * horizontal bands through the letters, and the hyphen no character but a
 * lagoon bar laid on the lagoon band (app.css .brand-name, .brand-dash).
 *
 * Three letters carry a small fix drawn by the stylesheet (app.css .brand-l-*):
 * the K and the h get their dark notch inside the lagoon band filled, the V
 * the tip of its inner point at the top of the green. The final e is drawn
 * apart, with stripes of its own (app.css .brand-e): its tail keeps out of the
 * lagoon, and the lagoon's lower edge curves up on its right.
 *
 * The rainbow a click sends across it is a copy of the same structure — the
 * same letters, the same boxes — with those fixes and stripes switched off, so
 * its letters fall exactly on the name's.
 */
export type BrandFix = 'k' | 'h' | 'v';

export type BrandPart =
  | { kind: 'text'; text: string }
  | { kind: 'dash' }
  | { kind: 'letter'; text: string; fix: BrandFix };

export type Brand = {
  /** Everything but the final e, striped as one. */
  body: BrandPart[];
  /** The final e, striped on its own; null when the name does not end with one. */
  tail: string | null;
};

const FIXES: Readonly<Record<string, BrandFix>> = { K: 'k', h: 'h', V: 'v' };

/**
 * « Koh-Vibe » → K (fixed), o, h (fixed), the bar, V (fixed), ib — and the e
 * apart. A name with no hyphen, or one at an edge, is one piece of text with
 * no tail: the stripes and their fixes are measured for this name only.
 */
export function brandName(name: string): Brand {
  const at = name.indexOf('-');
  if (at <= 0 || at === name.length - 1) return { body: [{ kind: 'text', text: name }], tail: null };
  const tail = name.endsWith('e') ? 'e' : null;
  const chars = tail === null ? name : name.slice(0, -1);
  const body: BrandPart[] = [];
  const fixed = new Set<BrandFix>();
  let run = '';
  const flush = (): void => {
    if (run !== '') body.push({ kind: 'text', text: run });
    run = '';
  };
  for (const [i, ch] of [...chars].entries()) {
    if (i === at) {
      flush();
      body.push({ kind: 'dash' });
      continue;
    }
    const fix = FIXES[ch];
    if (fix !== undefined && !fixed.has(fix)) {
      flush();
      fixed.add(fix);
      body.push({ kind: 'letter', text: ch, fix });
      continue;
    }
    run += ch;
  }
  flush();
  return { body, tail };
}
