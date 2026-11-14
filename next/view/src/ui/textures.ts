import type { TextureId } from '../../../src/shared/theme';

/**
 * The textures a theme can lay over the view (14/11): fine patterns on a
 * transparent ground, a faint light stroke for a firmer dark one: on Koh's
 * night grounds a light stroke shows far more than a dark one darkens, so the
 * light ones are kept thin and the page keeps its brightness — measured, a
 * point or two at full strength. Several stack.
 */
const svg = (w: number, h: number, body: string): string =>
  `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}'>${body}</svg>`)}")`;

/** Specks out of a noise: alpha from one channel, steep, so only its peaks show. */
const specks = (id: string, seed: number, rgb: string, gain: number): string =>
  `<filter id='${id}' x='0' y='0' width='100%' height='100%'><feTurbulence type='fractalNoise' baseFrequency='1.15' numOctaves='2' seed='${seed}' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 ${rgb} 0 0 0 0 ${rgb} 0 0 0 0 ${rgb} ${10 * gain} 0 0 0 ${-6.4 * gain}'/></filter><rect width='100%' height='100%' filter='url(#${id})'/>`;

export const TEXTURE: Record<TextureId, { image: string; size: string }> = {
  grain: { image: svg(140, 140, specks('l', 3, '1', 0.35) + specks('d', 9, '0', 1)), size: '140px 140px' },
  lines: {
    image: svg(6, 6, "<rect width='6' height='1' fill='#fff' fill-opacity='.12'/><rect y='3' width='6' height='1' fill='#000' fill-opacity='.5'/>"),
    size: '6px 6px',
  },
  diagonal: {
    image: svg(10, 10, "<path d='M-1 1l2-2M0 10L10 0M9 11l2-2' stroke='#fff' stroke-opacity='.12'/><path d='M-1 6l7-7M4 11l7-7' stroke='#000' stroke-opacity='.5'/>"),
    size: '10px 10px',
  },
  dots: { image: svg(12, 12, "<circle cx='3' cy='3' r='1' fill='#fff' fill-opacity='.35'/><circle cx='9' cy='9' r='1' fill='#000' fill-opacity='.6'/>"), size: '12px 12px' },
  grid: { image: svg(18, 18, "<path d='M18 .5H0M.5 0v18' stroke='#fff' stroke-opacity='.1'/><path d='M18 9.5H0M9.5 0v18' stroke='#000' stroke-opacity='.45'/>"), size: '18px 18px' },
};

/** The CSS for a set of textures: images and sizes, layer by layer — `none` for none. */
export function textureLayers(ids: readonly TextureId[]): { image: string; size: string } {
  if (ids.length === 0) return { image: 'none', size: 'auto' };
  return { image: ids.map((id) => TEXTURE[id].image).join(', '), size: ids.map((id) => TEXTURE[id].size).join(', ') };
}
