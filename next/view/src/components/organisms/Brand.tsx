import { Fragment, useRef, type Ref } from 'react';
import { brandName, type Brand } from '../../lib/brand';

/**
 * The name, and a rainbow that runs through it on each click (14/11). Every
 * click adds its own band on top of those still running — click fast and
 * several cross the letters at once. Each band is a layer of the same text,
 * transparent but for the band, laid over the name and gone when it is
 * through. Still under the system's reduced motion.
 */
export function BrandName({ text, striped = false }: { text: string; striped?: boolean }) {
  const ref = useRef<HTMLButtonElement>(null);
  const word = useRef<HTMLSpanElement>(null);
  return (
    <button
      ref={ref}
      type="button"
      className={`brand${striped ? ' brand-c2' : ''}`}
      aria-label={striped ? text : undefined}
      onClick={() => {
        const el = ref.current;
        if (el === null || typeof el.animate !== 'function' || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
        // The same structure as the name, copied — its letters and boxes —
        // so the band's letters fall on the name's (lib/brand.ts). The
        // stylesheet switches the copy's own stripes and fixes off.
        const band = document.createElement('span');
        band.className = 'brand-band';
        band.setAttribute('aria-hidden', 'true');
        if (word.current !== null) band.appendChild(word.current.cloneNode(true));
        else band.textContent = text;
        el.appendChild(band);
        const run = band.animate([{ backgroundPosition: '100% 0' }, { backgroundPosition: '0% 0' }], { duration: 750, easing: 'cubic-bezier(.4,0,.2,1)' });
        run.onfinish = () => band.remove();
        run.oncancel = () => band.remove();
      }}
    >
      {striped ? <StripedName brand={brandName(text)} spanRef={word} /> : text}
    </button>
  );
}

/**
 * The striped name (lib/brand.ts): the body striped as one, the three letters
 * with a fix of their own, and the final e striped apart.
 */
function StripedName({ brand, spanRef }: { brand: Brand; spanRef?: Ref<HTMLSpanElement> }) {
  return (
    <span ref={spanRef} className="brand-word" aria-hidden="true">
      <span className="brand-name">
        {brand.body.map((p, i) =>
          p.kind === 'text' ? (
            <Fragment key={i}>{p.text}</Fragment>
          ) : p.kind === 'dash' ? (
            <span key={i} className="brand-dash" />
          ) : (
            // The letter stays plain text, painted by the name's stripes; the
            // empty marker after it carries its fix (app.css .brand-fix-*).
            <Fragment key={i}>
              {p.text}
              <span className={`brand-fix brand-fix-${p.fix}`} />
            </Fragment>
          ),
        )}
      </span>
      {brand.tail !== null && <span className="brand-e">{brand.tail}</span>}
    </span>
  );
}

/**
 * While the view waits for the extension (15/11): the striped name, with the
 * rainbow running through it again and again — the click's band, on a loop.
 * Still under the system's reduced motion. The wait itself is said to screen
 * readers only.
 */
export function BootBrand({ label, name }: { label: string; name: string }) {
  const brand = brandName(name);
  return (
    <div className="boot" role="status" aria-label={label}>
      <span className="brand brand-c2 boot-brand" aria-hidden="true">
        <StripedName brand={brand} />
        <span className="brand-band boot-band">
          <StripedName brand={brand} />
        </span>
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
