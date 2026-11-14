import type { Tone } from '../format';

/**
 * The status dot. Same shapes moving or still: turning animation off — the
 * setting, or the system's reduced-motion preference (CSS) — stops the ring
 * at its starting angle and never swaps the drawing, as in V1.
 */
export function Dot({ tone, animate, size = 16, label }: { tone: Tone; animate: boolean; size?: number; label?: string }) {
  const ring = tone === 'wait' || tone === 'run' || tone === 'done' || tone === 'ended';
  const a11y = label === undefined ? { 'aria-hidden': true as const } : { role: 'img', 'aria-label': label };
  return (
    <svg className={`dot tone-${tone}`} width={size} height={size} viewBox="0 0 16 16" {...a11y}>
      {label !== undefined && <title>{label}</title>}
      {ring && (
        <circle
          className={tone === 'run' && animate ? 'spin' : undefined}
          cx="8"
          cy="8"
          r="6.2"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeDasharray={tone === 'run' ? '9 4' : tone === 'ended' ? '2 2.4' : undefined}
        />
      )}
      {tone !== 'ended' && <circle cx="8" cy="8" r="3" fill="currentColor" />}
    </svg>
  );
}

const PATHS = {
  info: (
    <>
      <circle cx="8" cy="8" r="6" />
      <path d="M8 7.2v4" />
      <circle cx="8" cy="4.9" r=".55" fill="currentColor" stroke="none" />
    </>
  ),
  chev: <path d="M5 6.5l3 3 3-3" />,
  chevR: <path d="M6.5 5l3 3-3 3" />,
  pin: <path d="M6 2.5h4l-.5 4 2 2H4.5l2-2zM8 8.5V14" />,
  doc: (
    <>
      <rect x="2.5" y="2.5" width="11" height="11" rx="2" />
      <path d="M5 6h6M5 8.5h6M5 11h3.5" />
    </>
  ),
  term: (
    <>
      <rect x="2" y="3" width="12" height="10" rx="1.5" />
      <path d="M4.5 6.5l2 1.5-2 1.5M8 10h3" />
    </>
  ),
  plug: <path d="M6 2v3M10 2v3M4.5 5h7v2.5a3.5 3.5 0 0 1-7 0zM8 11v3" />,
  gear: (
    <>
      <circle cx="8" cy="8" r="2.2" />
      <path d="M8 2.5v1.6M8 11.9v1.6M2.5 8h1.6M11.9 8h1.6M4.1 4.1l1.1 1.1M10.8 10.8l1.1 1.1M4.1 11.9l1.1-1.1M10.8 5.2l1.1-1.1" />
    </>
  ),
  search: (
    <>
      <circle cx="7" cy="7" r="4.2" />
      <path d="M10.2 10.2L13.5 13.5" />
    </>
  ),
  close: <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />,
  panel: (
    <>
      <rect x="2" y="3" width="12" height="10" rx="2" />
      <path d="M6 3v10" />
    </>
  ),
  external: <path d="M9 3h4v4M13 3L7.5 8.5M11 9.5V13H3V5h3.5" />,
  resume: <path d="M3 8a5 5 0 1 0 1.5-3.6L3 6M3 3v3h3" />,
  plus: <path d="M8 3v10M3 8h10" />,
  more: <path d="M3.5 8h.01M8 8h.01M12.5 8h.01" strokeWidth="2.2" />,
  moon: <path d="M12.5 9.5A5 5 0 0 1 6.5 3.5a5 5 0 1 0 6 6z" />,
  trash: <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5M6.8 7v4M9.2 7v4" />,
  copy: (
    <>
      <rect x="5.5" y="5.5" width="7.5" height="7.5" rx="1.5" />
      <path d="M10.5 5.5V4A1.5 1.5 0 0 0 9 2.5H4A1.5 1.5 0 0 0 2.5 4v5A1.5 1.5 0 0 0 4 10.5h1.5" />
    </>
  ),
  edit: <path d="M10.5 3l2.5 2.5L6 12.5H3.5V10zM9 4.5L11.5 7" />,
  clock: (
    <>
      <circle cx="8" cy="8" r="5.8" />
      <path d="M8 4.8V8l2.2 1.4" />
    </>
  ),
  columns: (
    <>
      <rect x="2" y="3" width="3.5" height="10" rx="1" />
      <rect x="6.25" y="3" width="3.5" height="7" rx="1" />
      <rect x="10.5" y="3" width="3.5" height="4.5" rx="1" />
    </>
  ),
  grid: (
    <>
      <rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1" />
      <rect x="9" y="2.5" width="4.5" height="4.5" rx="1" />
      <rect x="2.5" y="9" width="4.5" height="4.5" rx="1" />
      <rect x="9" y="9" width="4.5" height="4.5" rx="1" />
    </>
  ),
  list: <path d="M5.5 4h8M5.5 8h8M5.5 12h8M2.5 4h.01M2.5 8h.01M2.5 12h.01" />,
  bars: <path d="M3 13V8M6.5 13V4M10 13V6.5M13.5 13V10" />,
  user: (
    <>
      <circle cx="8" cy="5.5" r="2.6" />
      <path d="M3 13.5c.8-2.6 2.7-3.8 5-3.8s4.2 1.2 5 3.8" />
    </>
  ),
  chat: <path d="M3 4.5A1.5 1.5 0 0 1 4.5 3h7A1.5 1.5 0 0 1 13 4.5v5a1.5 1.5 0 0 1-1.5 1.5H7l-3 2.5V11h.5" />,
  bot: (
    <>
      <rect x="3.5" y="5.5" width="9" height="7" rx="2" />
      <path d="M8 3v2.5M6.3 9h.01M9.7 9h.01" />
    </>
  ),
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 14 }: { name: IconName; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="icon">
      {PATHS[name]}
    </svg>
  );
}
