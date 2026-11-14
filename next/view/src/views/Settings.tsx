import { useEffect, useState, type ReactNode } from 'react';
import { EDITOR_TABS, LANGUAGE_CHOICES, SETTING_TOGGLES, type SettingToggle } from '../../../src/shared/actions';
import { Segmented } from '../cockpit/Cockpit';
import { TidyRules } from '../ui/Rules';
import { SESSION_SORTS, type SessionSort } from '../sections';
import { Icon } from '../ui/icons';
import { Hint } from '../ui/Hint';
import { ThemeEditor } from './Theme';
import type { ViewCtx } from './context';

/**
 * The settings V1 and V2 share (settings.json), written through V1's store.
 * The two sounds are fixed — Attente when a conversation waits, Fin when it is
 * done (triage, 14/11): only their volume is set here.
 */
export function SettingsPanel({
  ctx,
  onClose,
  showUsage,
  onShowUsage,
  showTabNames,
  onShowTabNames,
  onSort,
}: {
  ctx: ViewCtx;
  onClose(): void;
  showUsage: boolean;
  onShowUsage(on: boolean): void;
  showTabNames: boolean;
  onShowTabNames(on: boolean): void;
  onSort(sort: SessionSort): void;
}) {
  const { t, snapshot } = ctx;
  const s = snapshot.settings;
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
        <button type="button" className="tbtn" aria-label={t('settings.close')} onClick={onClose}>
          <Icon name="close" />
        </button>
      </div>

      <section className="set-group">
        <h3>{t('settings.sound')}</h3>
        <label className="set-row">
          <span className="set-l">
            <b>{t('settings.volume')}</b>
            <span className="sub mono">{volume} %</span>
          </span>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={volume}
            onChange={(e) => setVolume(Number(e.target.value))}
            onPointerUp={commitVolume}
            onKeyUp={commitVolume}
            onBlur={commitVolume}
          />
        </label>
      </section>

      <section className="set-group">
        <h3>{t('settings.display')}</h3>
        <div className="set-row">
          <div className="set-l">
            <b id="set-show-usage">{t('settings.showUsage')}</b>
            <Hint text={t('settings.showUsage.hint')} />
          </div>
          <button type="button" role="switch" aria-checked={showUsage} aria-labelledby="set-show-usage" className="switch" onClick={() => onShowUsage(!showUsage)}>
            <span />
          </button>
        </div>
        <div className="set-row">
          <div className="set-l">
            <b id="set-tab-names">{t('settings.tabNames')}</b>
            <Hint text={t('settings.tabNames.hint')} />
          </div>
          <button type="button" role="switch" aria-checked={showTabNames} aria-labelledby="set-tab-names" className="switch" onClick={() => onShowTabNames(!showTabNames)}>
            <span />
          </button>
        </div>
        <Choice label={t('settings.sort')} hint={t('settings.sort.hint')}>
          <Segmented
            label={t('settings.sort')}
            options={SESSION_SORTS.map((v) => ({ value: v, label: t(`settings.sort.${v}`) }))}
            value={ctx.sort}
            onChange={onSort}
          />
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
              value={snapshot.editorTabs ?? 'multiple'}
              onChange={(mode) => void ctx.act({ kind: 'setting.editorTabs', mode })}
            />
          </Choice>
        )}
      </section>

      <section className="set-group">
        <h3>{t('settings.theme')}</h3>
        <ThemeEditor ctx={ctx} />
      </section>

      {snapshot.tidy !== undefined && (
        <section className="set-group">
          <h3>{t('settings.tidy')}</h3>
          <div className="set-row">
            <div className="set-l">
              <b id="set-tidy-ask">{t('settings.tidyAsk')}</b>
              <Hint text={t('settings.tidyAsk.hint')} />
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={snapshot.tidy.ask}
              aria-labelledby="set-tidy-ask"
              className="switch"
              onClick={() => void ctx.act({ kind: 'tidy.settings', ask: !(snapshot.tidy?.ask ?? true) })}
            >
              <span />
            </button>
          </div>
          <div className="set-row set-choice">
            <div className="set-l">
              <b>{t('settings.tidyRules')}</b>
            </div>
            <TidyRules
              t={t}
              rules={snapshot.tidy.rules}
              onAdd={() => void ctx.act({ kind: 'tidy.rules', mode: 'add' })}
              onOpen={() => void ctx.act({ kind: 'tidy.rules', mode: 'open' })}
            />
          </div>
        </section>
      )}

      <section className="set-group">
        <h3>{t('settings.behaviour')}</h3>
        {SETTING_TOGGLES.map((key) => (
          <Toggle key={key} ctx={ctx} k={key} on={s[key]} />
        ))}
      </section>
      <p className="hint pad">{t('settings.shared')}</p>
    </div>
  );
}

/** A setting with several answers: its name and what it does, the choice under them. */
function Choice({ label, hint, children }: { label: string; hint: string; children: ReactNode }) {
  return (
    <div className="set-row set-choice">
      <div className="set-l">
        <b>{label}</b>
        <Hint text={hint} />
      </div>
      {children}
    </div>
  );
}

function Toggle({ ctx, k, on }: { ctx: ViewCtx; k: SettingToggle; on: boolean }) {
  const { t } = ctx;
  return (
    <div className="set-row">
      <div className="set-l">
        <b id={`set-${k}`}>{t(`settings.${k}`)}</b>
        <Hint text={t(`settings.${k}.hint`)} />
      </div>
      <button type="button" role="switch" aria-checked={on} aria-labelledby={`set-${k}`} className="switch" onClick={() => void ctx.act({ kind: 'setting.toggle', key: k, on: !on })}>
        <span />
      </button>
    </div>
  );
}
