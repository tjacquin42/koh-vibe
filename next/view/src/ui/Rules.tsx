import type { Translate } from '../i18n';
import { Icon } from './icons';

/**
 * The tidying agent's rules (14/11), as the file holds them (host tidy.ts).
 * Written in a conversation opened for it, as a folder's rules are, or in the
 * file itself — never typed here.
 */
export function TidyRules({ t, rules, onAdd, onOpen }: { t: Translate; rules: readonly string[]; onAdd(): void; onOpen(): void }) {
  return (
    <div className="rules">
      {rules.length === 0 ? (
        <p className="muted small">{t('tidy.noRule')}</p>
      ) : (
        <ul>
          {rules.map((r, i) => (
            <li key={`${i}-${r}`}>{r}</li>
          ))}
        </ul>
      )}
      <div className="rule-btns">
        <button type="button" className="btn-ghost" onClick={onAdd}>
          <Icon name="chat" /> {t('tidy.addRule')}
        </button>
        {rules.length > 0 && (
          <button type="button" className="btn-ghost" onClick={onOpen}>
            <Icon name="doc" /> {t('tidy.openRules')}
          </button>
        )}
      </div>
    </div>
  );
}
