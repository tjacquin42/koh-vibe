/** An on/off setting, named by the element `labelledBy` points to. */
export function Switch({ on, labelledBy, onChange }: { on: boolean; labelledBy: string; onChange(on: boolean): void }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-labelledby={labelledBy} className="switch" onClick={() => onChange(!on)}>
      <span />
    </button>
  );
}
