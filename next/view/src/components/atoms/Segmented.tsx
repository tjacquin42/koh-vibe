/** One choice among a few, side by side. */
export function Segmented<T extends string | number>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  /** `disabled`: shown, greyed, not chosen — a place this editor cannot open (15/11). */
  options: readonly { value: T; label: string; disabled?: boolean }[];
  value: T;
  onChange(v: T): void;
}) {
  return (
    <div className="seg" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={String(o.value)} type="button" role="radio" aria-checked={o.value === value} disabled={o.disabled === true} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
