import { useEffect, useState } from 'react';
import { SETTING_TOGGLES, type SettingToggle } from '../../../src/shared/actions';
import { Icon } from '../ui/icons';
import type { ViewCtx } from './context';

/**
 * The settings V1 and V2 share (settings.json), written through V1's store.
 * The two sounds are fixed — Attente when a conversation waits, Fin when it is
 * done (triage, 14/11): only their volume is set here.
 */
export function SettingsPanel({ ctx, onClose, showUsage, onShowUsage }: { ctx: ViewCtx; onClose(): void; showUsage: boolean; onShowUsage(on: boolean): void }) {
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
          <span className="set-l">
            <b id="set-show-usage">{t('settings.showUsage')}</b>
            <span className="sub">{t('settings.showUsage.hint')}</span>
          </span>
          <button type="button" role="switch" aria-checked={showUsage} aria-labelledby="set-show-usage" className="switch" onClick={() => onShowUsage(!showUsage)}>
            <span />
          </button>
        </div>
      </section>

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

function Toggle({ ctx, k, on }: { ctx: ViewCtx; k: SettingToggle; on: boolean }) {
  const { t } = ctx;
  return (
    <div className="set-row">
      <span className="set-l">
        <b id={`set-${k}`}>{t(`settings.${k}`)}</b>
        <span className="sub">{t(`settings.${k}.hint`)}</span>
      </span>
      <button type="button" role="switch" aria-checked={on} aria-labelledby={`set-${k}`} className="switch" onClick={() => void ctx.act({ kind: 'setting.toggle', key: k, on: !on })}>
        <span />
      </button>
    </div>
  );
}
