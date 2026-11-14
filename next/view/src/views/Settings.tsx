import { useEffect, useState } from 'react';
import { SETTING_TOGGLES, type SettingToggle } from '../../../src/shared/actions';
import { Icon } from '../ui/icons';
import type { ViewCtx } from './context';

/**
 * The settings V1 and V2 share (settings.json), written through V1's store.
 * Sounds go through V1's picker: it plays each one as the selection moves,
 * which a list in a web view cannot do without shipping the sounds.
 */
export function SettingsPanel({ ctx, onClose }: { ctx: ViewCtx; onClose(): void }) {
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
        <h3>{t('settings.sounds')}</h3>
        {(['waiting', 'done'] as const).map((event) => (
          <div className="set-row" key={event}>
            <span className="set-l">
              <b>{t(`settings.sound.${event}`)}</b>
              <span className="sub">{s[event] === '' ? t('settings.sound.none') : s[event]}</span>
            </span>
            <button type="button" className="btn-ghost" onClick={() => void ctx.act({ kind: 'setting.sound', event })}>
              {t('settings.change')}
            </button>
          </div>
        ))}
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
