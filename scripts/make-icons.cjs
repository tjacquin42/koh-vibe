#!/usr/bin/env node
/**
 * Builds the extension's two icons from an island outline.
 *
 * The outline was traced BY HAND — hence the point table below, which is the
 * SOURCE and not a by-product. An SVG drawn directly would get retouched by
 * eye; here, fixing the coastline means fixing a point, and both icons follow
 * along together.
 *
 * Two icons, because they are not looked at the same way:
 * - the activity bar shows it at 24 px and recolors the shape: a solid,
 *   monochrome silhouette, simplified until the coastline stays legible at
 *   that size;
 * - the marketplace shows it at 256 px: the coastline keeps its detours there.
 *
 * Usage: node scripts/make-icons.cjs
 */
const { writeFileSync } = require('node:fs');
const { join } = require('node:path');

/** The island's outline, clockwise from the northern tip (pixels of the source). */
const OUTLINE = [
  [540, 25], [600, 60], [650, 140], [710, 168], [730, 100], [790, 140],
  [770, 232], [792, 300], [775, 420], [800, 470], [790, 560], [830, 610],
  [852, 592], [905, 572], [962, 592], [1022, 545], [1090, 572], [1122, 622],
  [1142, 690], [1212, 700], [1300, 678], [1340, 690], [1308, 752], [1336, 800],
  [1232, 880], [1170, 932], [1150, 992], [1078, 975], [985, 1032], [922, 1180],
  [898, 1268], [836, 1252], [806, 1160], [792, 1032], [778, 900], [735, 802],
  [700, 760], [612, 690], [520, 712], [430, 748], [352, 772], [300, 692],
  [270, 612], [266, 522], [212, 432], [126, 486], [70, 432], [160, 302],
  [166, 182], [200, 128], [300, 130], [400, 155], [470, 132],
];

/** Distance from a point to segment ab — the Ramer-Douglas-Peucker criterion. */
function distanceToSegment(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/**
 * Removes points that do not change the silhouette by more than `epsilon`.
 *
 * Shrinking a fifty-point trace down to 24 px does not give a more faithful
 * island: the inlets fall below a pixel and blur into grey mush. Better to
 * decide WHAT WE KEEP than let the renderer settle it at random.
 */
function simplify(points, epsilon) {
  if (points.length < 3) return [...points];
  let worst = 0;
  let at = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const d = distanceToSegment(points[i], points[0], points[points.length - 1]);
    if (d > worst) {
      worst = d;
      at = i;
    }
  }
  if (worst <= epsilon) return [points[0], points[points.length - 1]];
  const left = simplify(points.slice(0, at + 1), epsilon);
  const right = simplify(points.slice(at), epsilon);
  return [...left.slice(0, -1), ...right];
}

/**
 * Removes spikes too sharp for the target size.
 *
 * The island has a narrow inlet in the north. Shrunk to 24 px, it measures
 * less than a pixel wide and renders as a hair — a black needle stuck into
 * the silhouette, read as a drawing defect rather than a coastline.
 * Simplification alone does not remove it: the inlet is DEEP, so RDP judges
 * it essential; it is its angle, not its deviation, that condemns it.
 */
function dropSpikes(points, minAngleDeg) {
  const limit = (minAngleDeg * Math.PI) / 180;
  let kept = [...points];
  for (let pass = 0; pass < 4; pass++) {
    const next = kept.filter((p, i) => {
      const a = kept[(i - 1 + kept.length) % kept.length];
      const b = kept[(i + 1) % kept.length];
      const angle = Math.abs(
        Math.atan2(a[1] - p[1], a[0] - p[0]) - Math.atan2(b[1] - p[1], b[0] - p[0]),
      );
      const between = angle > Math.PI ? 2 * Math.PI - angle : angle;
      return between > limit;
    });
    if (next.length === kept.length || next.length < 8) return kept;
    kept = next;
  }
  return kept;
}

/** Fits the outline into a `size` square, centered, keeping its proportions. */
function fit(points, size, padding) {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const span = Math.max(Math.max(...xs) - minX, Math.max(...ys) - minY);
  const scale = (size - 2 * padding) / span;
  const offsetX = padding + ((size - 2 * padding) - (Math.max(...xs) - minX) * scale) / 2;
  const offsetY = padding + ((size - 2 * padding) - (Math.max(...ys) - minY) * scale) / 2;
  return points.map(([x, y]) => [(x - minX) * scale + offsetX, (y - minY) * scale + offsetY]);
}

/**
 * A closed, smoothed path (Catmull-Rom converted to cubics).
 *
 * A coastline is not a polyline: joined by straight segments, the silhouette
 * looks like a video-game polygon. `tension` at 0 would render straight
 * segments; at 1 the curve passes through every point while rounding it off.
 */
function smoothClosedPath(points, tension) {
  const n = points.length;
  const round = (v) => Math.round(v * 100) / 100;
  let d = `M${round(points[0][0])} ${round(points[0][1])}`;
  for (let i = 0; i < n; i++) {
    const p0 = points[(i - 1 + n) % n];
    const p1 = points[i];
    const p2 = points[(i + 1) % n];
    const p3 = points[(i + 2) % n];
    const c1 = [p1[0] + ((p2[0] - p0[0]) / 6) * tension, p1[1] + ((p2[1] - p0[1]) / 6) * tension];
    const c2 = [p2[0] - ((p3[0] - p1[0]) / 6) * tension, p2[1] - ((p3[1] - p1[1]) / 6) * tension];
    d += `C${round(c1[0])} ${round(c1[1])} ${round(c2[0])} ${round(c2[1])} ${round(p2[0])} ${round(p2[1])}`;
  }
  return `${d}Z`;
}

const resources = join(__dirname, '..', 'resources');

// --- Activity bar: 24 px, monochrome, recolored by VSCode ---
// Renaming this file is the ONLY safe way to get a new drawing picked up: the
// icon is served to the renderer by a file URL, which the editor caches, and
// the package always keeps the same version and the same path. Without a
// name change, reinstalling does not change the URL and the old drawing keeps
// showing, even after a window reload.
const small = smoothClosedPath(fit(dropSpikes(simplify(OUTLINE, 55), 42), 24, 1.2), 0.5);
writeFileSync(
  join(resources, 'logo-mono.svg'),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">
  <path d="${small}" fill="#000"/>
</svg>
`,
  'utf8',
);

// --- Marketplace: 256 px, in color ---
// The shoal is the SAME path, stroked as an outline: scaling it up separately
// gave a ring thick on one side and absent on the other, since scaling does
// not move away from the coastline, it moves away from the center.
const big = smoothClosedPath(fit(OUTLINE, 256, 34), 0.7);
writeFileSync(
  join(resources, 'logo.svg'),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256">
  <defs>
    <linearGradient id="sea" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#123642"/>
      <stop offset="1" stop-color="#0A1F28"/>
    </linearGradient>
    <linearGradient id="land" x1="0.2" y1="0" x2="0.8" y2="1">
      <stop offset="0" stop-color="#8BE0A0"/>
      <stop offset="1" stop-color="#3FA872"/>
    </linearGradient>
  </defs>
  <rect width="256" height="256" rx="56" fill="url(#sea)"/>
  <path d="${big}" fill="none" stroke="#2E8494" stroke-width="13" stroke-linejoin="round" opacity="0.5"/>
  <path d="${big}" fill="none" stroke="#3FA8B8" stroke-width="5" stroke-linejoin="round" opacity="0.5"/>
  <path d="${big}" fill="url(#land)"/>
</svg>
`,
  'utf8',
);

console.log(
  `contour : ${OUTLINE.length} points, réduit à ${dropSpikes(simplify(OUTLINE, 55), 42).length} pour 24 px`,
);
