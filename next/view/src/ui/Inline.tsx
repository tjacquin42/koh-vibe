import { useRef, useState, type ReactNode } from 'react';

/**
 * A name typed in place: Enter keeps it, Escape gives up (`undefined`). An
 * emptied field gives up too — unless `allowEmpty`, where it answers `''`, a
 * choice of its own (« no project ») that Escape must never be taken for.
 */
export function NameInput({
  initial,
  label,
  max,
  onDone,
  list,
  allowEmpty,
}: {
  initial: string;
  label: string;
  max: number;
  onDone(name: string | undefined): void;
  list?: string;
  allowEmpty?: boolean;
}) {
  const [value, setValue] = useState(initial);
  const done = useRef(false);
  const finish = (name: string | undefined): void => {
    if (done.current) return;
    done.current = true;
    onDone(name);
  };
  const kept = (): string | undefined => (value.trim() === '' && allowEmpty !== true ? undefined : value.trim());
  return (
    <input
      className="name-input"
      aria-label={label}
      value={value}
      maxLength={max}
      autoFocus
      {...(list === undefined ? {} : { list })}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') finish(kept());
        if (e.key === 'Escape') finish(undefined);
      }}
      onBlur={() => finish(kept())}
    />
  );
}

/**
 * A question asked in place, for what cannot be undone or acts for real —
 * a red button when it destroys, a plain one when it only acts.
 */
export function Confirm({
  children,
  yes,
  no,
  danger,
  onYes,
  onNo,
}: {
  children: ReactNode;
  yes: string;
  no: string;
  danger: boolean;
  onYes(): void;
  onNo(): void;
}) {
  return (
    <div className={danger ? 'confirm' : 'confirm calm'} role="alertdialog">
      <p>{children}</p>
      <div className="confirm-btns">
        <button type="button" className={danger ? 'btn-danger' : 'btn-go'} onClick={onYes}>
          {yes}
        </button>
        <button type="button" className="btn-ghost" onClick={onNo}>
          {no}
        </button>
      </div>
    </div>
  );
}
