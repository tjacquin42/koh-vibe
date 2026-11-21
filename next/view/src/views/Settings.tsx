import { useEffect, useState } from 'react';
import { ARTIFACT_OPENS, EDITOR_TABS, LANGUAGE_CHOICES, SETTING_TOGGLES } from '../../../src/shared/actions';
import type { ViewCtx } from '../context';
import { SESSION_SORTS, type SessionSort } from '../sections';
import { ARCHIVE_COUNTS, type ArchiveCount } from '../ui-state';
import { IconButton } from '../components/atoms/IconButton';
import { Segmented } from '../components/atoms/Segmented';
import { Choice, SwitchRow } from '../components/molecules/SettingRow';
import { ThemeEditor } from '../components/organisms/ThemeEditor';

/**
 * The settings V1 and V2 share (settings.json), written through V1's store,
 * and those the view keeps for itself. The two sounds are fixed — Attente
 * when a conversation waits, Fin when it is done (triage, 14/11): only their
 * volume is set here.
 */
export function SettingsPanel({
  ctx,
  onClose,
  showUsage,
  onShowUsage,
  onSort,
  onArchives,
}: {
  ctx: ViewCtx;
  onClose(): void;
  showUsage: boolean;
  onShowUsage(on: boolean): void;
  onSort(sort: SessionSort): void;
  onArchives(count: ArchiveCount): void;
}) {
  const { t, snapshot } = ctx;
  const s = snapshot.settings;
  const tidy = snapshot.tidy;
  // Where artifacts open (15/11): the editor's integrated browser where it has one, greyed where not.
  const inEditor = snapshot.editor?.integratedBrowser === true;
  // The slider moves freely; the file is written once, when it is let go.
  const [volume, setVolume] = useState(s.volume);
  useEffect(() => setVolume(s.volume), [s.volume]);
  const commitVolume = (): void => {
    if (volume !== s.volume) void ctx.act({ kind: 'setting.volume', percent: volume });
  };
  return (
    <div className="settings">
      <div className="settings-head">
        <h2>{t('settings.title')}</h2>
        <IconButton icon="close" label={t('settings.close')} onClick={onClose} />
      </div>

      <section className="set-group">
        <h3>{t('settings.sound')}</h3>
        <label className="set-row">
          <span className="set-l">
            <b>{t('settings.volume')}</b>
            <span className="sub mono">{volume} %</span>
          </span>
          <input type="range" min={0} max={100} step={5} value={volume} onChange={(e) => setVolume(Number(e.target.value))} onPointerUp={commitVolume} onKeyUp={commitVolume} onBlur={commitVolume} />
        </label>
      </section>

      <section className="set-group">
        <h3>{t('settings.display')}</h3>
        <SwitchRow id="set-show-usage" label={t('settings.showUsage')} hint={t('settings.showUsage.hint')} on={showUsage} onChange={onShowUsage} />
        <Choice label={t('settings.artifactOpen')} hint={t('settings.artifactOpen.hint')}>
          <Segmented
            label={t('settings.artifactOpen')}
            options={ARTIFACT_OPENS.map((v) => ({ value: v, label: t(`settings.artifactOpen.${v}`), disabled: v !== 'browser' && !inEditor }))}
            value={inEditor ? (snapshot.artifactOpen ?? 'browser') : 'browser'}
            onChange={(where) => void ctx.act({ kind: 'setting.artifactOpen', where })}
          />
          {snapshot.editor !== undefined && !inEditor && <span className="sub set-note">{t('settings.artifactOpen.none', { app: snapshot.editor.name })}</span>}
        </Choice>
        <Choice label={t('settings.sort')} hint={t('settings.sort.hint')}>
          <Segmented label={t('settings.sort')} options={SESSION_SORTS.map((v) => ({ value: v, label: t(`settings.sort.${v}`) }))} value={ctx.sort} onChange={onSort} />
        </Choice>
        <Choice label={t('settings.archives')} hint={t('settings.archives.hint')}>
          <Segmented label={t('settings.archives')} options={ARCHIVE_COUNTS.map((v) => ({ value: v, label: String(v) }))} value={ctx.archives} onChange={onArchives} />
        </Choice>
        <Choice label={t('settings.language')} hint={t('settings.language.hint')}>
          <Segmented
            label={t('settings.language')}
            options={LANGUAGE_CHOICES.map((v) => ({ value: v, label: t(`settings.language.${v}`) }))}
            value={ctx.languageChoice}
            onChange={(choice) => void ctx.act({ kind: 'setting.language', choice })}
          />
        </Choice>
        {snapshot.editorTabs !== undefined && (
          <Choice label={t('settings.editorTabs')} hint={t('settings.editorTabs.hint')}>
            <Segmented
              label={t('settings.editorTabs')}
              options={EDITOR_TABS.map((v) => ({ value: v, label: t(`settings.editorTabs.${v}`) }))}
              value={snapshot.editorTabs}
              onChange={(mode) => void ctx.act({ kind: 'setting.editorTabs', mode })}
            />
          </Choice>
        )}
      </section>

      {tidy !== undefined && (
        <section className="set-group">
          <h3>{t('settings.tidy')}</h3>
          <SwitchRow id="set-tidy-ask" label={t('settings.tidyAsk')} hint={t('settings.tidyAsk.hint')} on={tidy.ask} onChange={(ask) => void ctx.act({ kind: 'tidy.settings', ask })} />
        </section>
      )}

      <section className="set-group">
        <h3>{t('settings.behaviour')}</h3>
        {SETTING_TOGGLES.map((key) => (
          <SwitchRow key={key} id={`set-${key}`} label={t(`settings.${key}`)} hint={t(`settings.${key}.hint`)} on={s[key]} onChange={(on) => void ctx.act({ kind: 'setting.toggle', key, on })} />
        ))}
      </section>
      <section className="set-group">
        <h3>{t('settings.theme')}</h3>
        <ThemeEditor ctx={ctx} />
      </section>
      <p className="hint pad">{t('settings.shared')}</p>
    </div>
  );
}
