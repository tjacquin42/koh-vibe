import { useEffect, useState } from 'react';
import { DEFAULT_THEME, DEFAULT_TUNE, sameTune, THEME_RANGE, type ThemeState, type ThemeTune } from '../../../src/shared/theme';
import { Hint } from '../ui/Hint';
import { previewTheme, relativeFilter } from '../ui/theme';
import type { ViewCtx } from './context';

const STEPS: Record<keyof ThemeTune, number> = { hue: 1, saturation: 5, brightness: 1 };

/**
 * Koh-Vibe's colours (14/11): hue, saturation, brightness, shown live while
 * a slider moves and kept when it is let go; four slots keep tunings to come
 * back to. Every view follows: the state lives in the editor.
 */
export function ThemeEditor({ ctx }: { ctx: ViewCtx }) {
  const { t } = ctx;
  const theme = ctx.snapshot.theme ?? DEFAULT_THEME;
  const [draft, setDraft] = useState<ThemeTune>(theme.current);
  const [moving, setMoving] = useState(false);
  useEffect(() => {
    if (!moving) setDraft(theme.current);
  }, [theme.current, moving]);
  // Leaving the settings mid-move must not leave a preview behind.
  useEffect(() => () => previewTheme(undefined), []);

  const save = (next: ThemeState): void => {
    void ctx.act({ kind: 'theme.set', theme: next }).finally(() => {
      setMoving(false);
      previewTheme(undefined);
    });
  };
  const move = (key: keyof ThemeTune, value: number): void => {
    const next = { ...draft, [key]: value };
    setMoving(true);
    setDraft(next);
    previewTheme(next);
  };
  const commit = (): void => {
    if (moving && !sameTune(draft, theme.current)) save({ ...theme, current: draft });
    else {
      setMoving(false);
      previewTheme(undefined);
    }
  };
  const show = (key: keyof ThemeTune): string =>
    key === 'hue' ? `${draft.hue > 0 ? '+' : ''}${draft.hue}°` : `${draft[key]} %`;

  return (
    <>
      {(['hue', 'saturation', 'brightness'] as const).map((key) => (
        <label key={key} className="set-row">
          <span className="set-l">
            <b>{t(`theme.${key}`)}</b>
            <span className="sub mono">{show(key)}</span>
          </span>
          <input
            type="range"
            min={THEME_RANGE[key].min}
            max={THEME_RANGE[key].max}
            step={STEPS[key]}
            value={draft[key]}
            onChange={(e) => move(key, Number(e.target.value))}
            onPointerUp={commit}
            onKeyUp={commit}
            onBlur={commit}
            onDoubleClick={() => save({ ...theme, current: { ...draft, [key]: DEFAULT_TUNE[key] } })}
          />
        </label>
      ))}
      <div className="set-row set-choice">
        <div className="set-l">
          <b>{t('theme.slots')}</b>
          <Hint text={t('theme.slots.hint')} />
        </div>
        <div className="tslots">
          {theme.slots.map((slot, i) => {
            const n = i + 1;
            const on = slot !== null && sameTune(slot, draft);
            return (
              <div key={i} className="tslot">
                <button
                  type="button"
                  className={`tswatch${slot === null ? ' empty' : ''}`}
                  aria-pressed={on}
                  aria-label={slot === null ? t('theme.emptySlot', { n }) : t('theme.apply', { n })}
                  disabled={slot === null}
                  style={slot === null ? undefined : { filter: relativeFilter(slot, draft) }}
                  onClick={() => slot !== null && save({ ...theme, current: slot })}
                >
                  {slot === null ? (
                    <span>{t('theme.empty')}</span>
                  ) : (
                    <>
                      <i className="tone-wait" />
                      <i className="tone-run" />
                      <i className="tone-done" />
                      <i className="accent" />
                    </>
                  )}
                </button>
                <button
                  type="button"
                  className="btn-ghost tsave"
                  aria-label={t('theme.saveIn', { n })}
                  onClick={() => save({ ...theme, current: draft, slots: theme.slots.map((s, j) => (j === i ? draft : s)) })}
                >
                  {t('theme.save')}
                </button>
              </div>
            );
          })}
        </div>
        <button type="button" className="btn-ghost treset" disabled={sameTune(draft, DEFAULT_TUNE)} onClick={() => save({ ...theme, current: DEFAULT_TUNE })}>
          {t('theme.reset')}
        </button>
      </div>
      <div className="set-row set-choice">
        <div className="set-l">
          <b>{t('theme.ide')}</b>
          <Hint text={t('theme.ide.hint')} />
        </div>
        <div className="rule-btns">
          <button
            type="button"
            className={`btn-ghost${ctx.isBusy('ide-theme') ? ' busy' : ''}`}
            onClick={() => void ctx.track('ide-theme', ctx.act({ kind: 'theme.ide', mode: 'adapt' }), 600)}
          >
            {t('theme.ide.adapt')}
          </button>
          <button
            type="button"
            className="btn-ghost"
            disabled={ctx.snapshot.ideThemed !== true}
            onClick={() => void ctx.track('ide-theme', ctx.act({ kind: 'theme.ide', mode: 'restore' }), 600)}
          >
            {t('theme.ide.restore')}
          </button>
        </div>
      </div>
    </>
  );
}
