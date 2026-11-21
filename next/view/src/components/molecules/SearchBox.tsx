import type { Translate } from '../../i18n';
import { TEXT_MENU } from '../../lib/menu-context';
import { Icon } from '../atoms/Icon';
import { IconButton } from '../atoms/IconButton';

/** The sidebar's search: Escape or its × empties it, and the tabs come back. */
export function SearchBox({ t, query, onChange }: { t: Translate; query: string; onChange(q: string): void }) {
  return (
    <div className="search">
      <Icon name="search" />
      <input
        data-vscode-context={TEXT_MENU}
        type="search"
        value={query}
        placeholder={t('search.placeholder')}
        aria-label={t('search.label')}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onChange('');
        }}
      />
      {query.length > 0 && <IconButton icon="close" label={t('search.clear')} onClick={() => onChange('')} />}
    </div>
  );
}
