import type { SessionView } from '../../../src/shared/protocol';
import { sessionTitle } from '../format';
import type { Translate } from '../i18n';

/**
 * A conversation's name. One just opened, with nothing written yet, is
 * « New », in italics and rainbow colours (14/11) — the same word in every
 * language, as asked; the colours run only while animations are on.
 */
export function SessionName({ s, t, animate }: { s: SessionView; t: Translate; animate: boolean }) {
  if (s.fresh === true && (s.title === undefined || s.title.trim() === '')) {
    return <em className={`new-name${animate ? ' moving' : ''}`}>New</em>;
  }
  return <>{sessionTitle(s, t)}</>;
}
