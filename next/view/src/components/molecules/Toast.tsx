import { IconButton } from '../atoms/IconButton';

/** A short line at the bottom that goes away by itself, or at its ×. */
export function Toast({ text, closeLabel, onClose }: { text: string; closeLabel: string; onClose(): void }) {
  return (
    <div className="toast" role="status">
      <span>{text}</span>
      <IconButton icon="close" label={closeLabel} onClick={onClose} />
    </div>
  );
}
