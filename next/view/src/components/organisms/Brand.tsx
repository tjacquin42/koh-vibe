import { useRef, type CSSProperties } from 'react';
import { WORDMARK } from '../../assets/wordmark';

/**
 * The image's own shape, for the rainbow: the band is masked by it, so the
 * colours run through the letters' stripes and nowhere else.
 */
const MASK: CSSProperties & Record<'--brand-mask', string> = { '--brand-mask': `url("${WORDMARK}")` };

/**
 * The name, and a rainbow that runs through it on each click (14/11). Every
 * click adds its own band on top of those still running — click fast and
 * several cross the letters at once. The sidebar's name is the large drawing
 * as an image (16/11, assets/wordmark.ts); its band is a layer cut to the
 * image's shape. The cockpit's title stays text, its band a layer of the same
 * text. Still under the system's reduced motion.
 */
export function BrandName({ text, striped = false }: { text: string; striped?: boolean }) {
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <button
      ref={ref}
      type="button"
      className={`brand${striped ? ' brand-c2' : ''}`}
      style={striped ? MASK : undefined}
      aria-label={striped ? text : undefined}
      onClick={() => {
        const el = ref.current;
        if (el === null || typeof el.animate !== 'function' || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
        const band = document.createElement('span');
        band.className = striped ? 'brand-band brand-band-mask' : 'brand-band';
        band.setAttribute('aria-hidden', 'true');
        if (!striped) band.textContent = text;
        el.appendChild(band);
        const run = band.animate([{ backgroundPosition: '100% 0' }, { backgroundPosition: '0% 0' }], { duration: 750, easing: 'cubic-bezier(.4,0,.2,1)' });
        run.onfinish = () => band.remove();
        run.oncancel = () => band.remove();
      }}
    >
      {striped ? <img className="brand-img" src={WORDMARK} alt="" draggable={false} /> : text}
    </button>
  );
}

/**
 * While the view waits for the extension (15/11): the name, with the rainbow
 * running through it again and again — the click's band, on a loop. Still
 * under the system's reduced motion. The wait itself is said to screen readers
 * only.
 */
export function BootBrand({ label }: { label: string }) {
  return (
    <div className="boot" role="status" aria-label={label}>
      <span className="brand brand-c2 boot-brand" style={MASK} aria-hidden="true">
        <img className="brand-img" src={WORDMARK} alt="" draggable={false} />
        <span className="brand-band brand-band-mask boot-band" />
      </span>
    </div>
  );
}

/**
 * The logo alone — a half sun over two strokes of sea — where the sidebar is
 * too narrow for the name (app.css container query). In the logo's own
 * colours, those the name is striped with (15/11): coral, lagoon, sea green.
 * Never a glow nor a pulse (refused, 14/11).
 */
export function BrandLogo({ label }: { label: string }) {
  return (
    <span className="brand-logo" role="img" aria-label={label}>
      <svg viewBox="36 56 184 176" width="26" height="25" aria-hidden="true">
        <path d="M53 139A75 75 0 0 1 203 139Z" fill="var(--wait)" />
        <path d="M43 181H149" fill="none" stroke="var(--run)" strokeWidth="21" strokeLinecap="round" />
        <path d="M107 219H213" fill="none" stroke="var(--done)" strokeWidth="21" strokeLinecap="round" />
      </svg>
    </span>
  );
}
