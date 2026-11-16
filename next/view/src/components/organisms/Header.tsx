import type { Snapshot, Surface } from '../../../../src/shared/protocol';
import { countsOf } from '../../format';
import type { Translate } from '../../i18n';
import { IconButton } from '../atoms/IconButton';
import { StatusCounts } from '../molecules/StatusCounts';
import { BrandLogo, BrandName } from './Brand';

/** What the sidebar's header offers beside its name; the cockpit's has its title alone. */
export interface HeaderTools {
  onCockpit(): void;
  onNew(): void;
  newBusy: boolean;
  settingsOpen: boolean;
  onSettings(): void;
}

/**
 * The top of a view. The sidebar's: its name striped with the logo's colours
 * (C2, 14/11) — the logo alone where it is too narrow — its version, its
 * tools, and the counts of the open conversations, but over the settings,
 * which are not about them (14/11). The cockpit's: its title, and nothing
 * else — it counts its chosen folder itself, under its folders (CockpitTop).
 */
export function Header({ t, snapshot, surface, version, tools }: { t: Translate; snapshot: Snapshot; surface: Surface; /** Shown when it is one (not « preview »). */ version: string; tools?: HeaderTools }) {
  const sidebar = surface === 'sidebar';
  return (
    <header className="head">
      <div className="title">
        <h1>
          <BrandName text={sidebar ? t('app.name') : t('cockpit.title')} striped={sidebar} />
        </h1>
        {sidebar && <BrandLogo label={t('app.name')} />}
        {sidebar && /^\d/.test(version) && <span className="ver mono">v{version}</span>}
        {tools !== undefined && (
          <span className="head-tools">
            <IconButton kind="head" icon="plus" size={16} label={t('action.newSession')} busy={tools.newBusy} onClick={tools.onNew} />
            <IconButton kind="head" icon="gear" size={16} label={t('action.settings')} pressed={tools.settingsOpen} onClick={tools.onSettings} />
            <IconButton kind="head" icon="panel" size={16} label={t('action.cockpit')} onClick={tools.onCockpit} />
          </span>
        )}
      </div>
      {tools !== undefined && !tools.settingsOpen && <StatusCounts counts={countsOf(snapshot.sessions)} t={t} />}
    </header>
  );
}
