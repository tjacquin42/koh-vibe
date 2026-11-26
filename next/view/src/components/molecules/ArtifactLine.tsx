import { cx } from '../../lib/cx';
import { Icon } from '../atoms/Icon';

/**
 * An artifact on a line, wherever it shows — the Artifacts tab, a folder of
 * conversations: its icon, its title, its age when there is one to say; a
 * click opens its page.
 *
 * Just filed in a folder of conversations (16/11), it says so for a moment:
 * a tick in place of its icon, and where it went in place of its age — the
 * folder is on another tab, so nothing else on screen would show it worked.
 */
export function ArtifactLine({
  name,
  openLabel,
  onOpen,
  age,
  filedIn,
  moving = false,
}: {
  name: string;
  openLabel: string;
  onOpen(): void;
  age?: string;
  /** What to say of where it was just filed (« → Shop »); `undefined` otherwise. */
  filedIn?: string;
  /** With the Animations setting on: the tick pops in. Off, it only shows. */
  moving?: boolean;
}) {
  const filed = filedIn !== undefined;
  return (
    <button type="button" className={cx('row row-btn', filed && 'filed', filed && moving && 'moving')} onClick={onOpen} aria-label={openLabel}>
      <Icon name={filed ? 'check' : 'doc'} />
      <span className="ttl">{name}</span>
      {filed ? (
        <span className="tm filed-in" role="status">
          {filedIn}
        </span>
      ) : (
        age !== undefined && <span className="tm">{age}</span>
      )}
    </button>
  );
}
