import { useState } from 'react';
import { MAX_RULE } from '../../../src/shared/actions';
import type { Translate } from '../i18n';
import { Icon } from './icons';

/**
 * The tidying agent's rules (14/11): one sentence each, as typed — « recipes
 * go to Cooking ». Added with Enter, taken away with their ×.
 */
export function RulesEditor({ t, rules, onChange }: { t: Translate; rules: readonly string[]; onChange(rules: string[]): void }) {
  const [draft, setDraft] = useState('');
  const add = (): void => {
    const rule = draft.trim();
    if (rule.length === 0 || rules.includes(rule)) return;
    onChange([...rules, rule]);
    setDraft('');
  };
  return (
    <div className="rules">
      {rules.length > 0 && (
        <ul>
          {rules.map((r) => (
            <li key={r}>
              <span>{r}</span>
              <button type="button" className="tbtn" aria-label={t('tidy.removeRule', { rule: r })} onClick={() => onChange(rules.filter((x) => x !== r))}>
                <Icon name="close" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="rule-add">
        <input
          className="name-input"
          value={draft}
          maxLength={MAX_RULE}
          placeholder={t('tidy.rulePlaceholder')}
          aria-label={t('tidy.addRule')}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') add();
          }}
        />
        <button type="button" className="btn-ghost" onClick={add} disabled={draft.trim().length === 0}>
          {t('tidy.add')}
        </button>
      </div>
    </div>
  );
}
