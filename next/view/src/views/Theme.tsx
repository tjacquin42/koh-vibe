import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';
import { DEFAULT_THEME, DEFAULT_TUNE, GROUNDS, groundColours, sameTune, TEXTURES, THEME_RANGE, type ThemeState, type ThemeTune } from '../../../src/shared/theme';
import { previewTheme } from '../ui/theme';
import { TEXTURE, textureLayers } from '../ui/textures';
import type { ViewCtx } from './context';

/**
 * Koh-Vibe's colours (14/11), à la Arc: a pad to pick the colour — hue
 * across, intensity up and down — a brightness, and a grain laid over the
 * whole view. Only the background takes them (15/11): the buttons, the logo
 * and the colours of the states keep theirs. The background can also be the
 * editor's own, which the pad and the brightness leave alone. Shown live
 * while something moves, kept when it is let go; four slots keep tunings to
 * come back to. Every view follows: the state lives in the editor.
 */
export function ThemeEditor({ ctx }: { ctx: ViewCtx }) {
  const { t } = ctx;
  const theme = ctx.snapshot.theme ?? DEFAULT_THEME;
  const [draft, setDraft] = useState<ThemeTune>(theme.current);
  // The latest value at once: a release can come before the move it ends has rendered.
  const live = useRef<ThemeTune>(theme.current);
  const moving = useRef(false);
  useEffect(() => {
    if (moving.current) return;
    live.current = theme.current;
    setDraft(theme.current);
  }, [theme.current]);
  // Leaving the settings mid-move must not leave a preview behind.
  useEffect(() => () => previewTheme(undefined), []);

  const save = (next: ThemeState): void => {
    live.current = next.current;
    setDraft(next.current);
    // Shown at once, not when the host answers: a click must show its effect.
    previewTheme(next.current);
    // The preview stays until the stored tuning catches up (ui/theme.ts),
    // or goes back at once when the write failed.
    void ctx.act({ kind: 'theme.set', theme: next }).then((r) => {
      moving.current = false;
      if (!r.ok) previewTheme(undefined);
    });
  };
  const move = (change: Partial<ThemeTune>): void => {
    const next = { ...live.current, ...change };
    live.current = next;
    moving.current = true;
    setDraft(next);
    previewTheme(next);
  };
  const commit = (): void => {
    if (moving.current && !sameTune(live.current, theme.current)) save({ ...theme, current: live.current });
    else {
      moving.current = false;
      previewTheme(undefined);
    }
  };

  const ide = draft.ground === 'ide';
  return (
    <>
      <div className={`set-row set-choice${ide ? ' off' : ''}`} aria-disabled={ide}>
        <div className="set-l">
          <b>{t('theme.colour')}</b>
        </div>
        <ColorPad
          label={t('theme.colour')}
          disabled={ide}
          tune={draft}
          onMove={move}
          onCommit={commit}
          onReset={() => save({ ...theme, current: { ...live.current, hue: DEFAULT_TUNE.hue, saturation: DEFAULT_TUNE.saturation } })}
        />
      </div>
      <Slider
        label={t('theme.brightness')}
        disabled={ide}
        value={draft.brightness}
        shown={`${draft.brightness} %`}
        range={THEME_RANGE.brightness}
        track="trange-light"
        onMove={(brightness) => move({ brightness })}
        onCommit={commit}
        onReset={() => save({ ...theme, current: { ...live.current, brightness: DEFAULT_TUNE.brightness } })}
      />
      <div className="set-row set-choice">
        <div className="set-l">
          <b>{t('theme.grain')}</b>
        </div>
        {/* Several at once; the first one picked starts at two fifths of the strength (15/11). */}
        <div className="ttex" role="group" aria-label={t('theme.grain')}>
          {TEXTURES.map((id) => {
            const on = draft.textures.includes(id);
            // Read at the click, not at the render: two quick clicks must both count.
            const pick = (): void => {
              const now = live.current;
              const was = now.textures.includes(id);
              const textures = was ? now.textures.filter((x) => x !== id) : TEXTURES.filter((x) => x === id || now.textures.includes(x));
              save({ ...theme, current: { ...now, textures, grain: !was && now.grain === 0 ? TEXTURE_START : now.grain } });
            };
            return (
              <button key={id} type="button" aria-pressed={on} onClick={pick}>
                <i style={{ backgroundImage: TEXTURE[id].image, backgroundSize: TEXTURE[id].size }} />
                {t(`theme.texture.${id}`)}
              </button>
            );
          })}
        </div>
      </div>
      {draft.textures.length > 0 && (
        <Slider
          label={t('theme.grain.strength')}
          value={draft.grain}
          shown={`${draft.grain} %`}
          range={THEME_RANGE.grain}
          track="trange-grain"
          onMove={(grain) => move({ grain })}
          onCommit={commit}
          onReset={() => save({ ...theme, current: { ...live.current, grain: TEXTURE_START } })}
        />
      )}
      <div className="set-row set-choice">
        <div className="set-l">
          <b>{t('theme.slots')}</b>
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
                  style={slot === null ? undefined : { ...swatchGround(slot), ...swatchTexture(slot) }}
                  onClick={() => slot !== null && save({ ...theme, current: slot })}
                >
                  {slot === null ? (
                    <span>{t('theme.empty')}</span>
                  ) : (
                    <>
                      <i className="ground-surface" />
                      <i className="ground-raised" />
                    </>
                  )}
                </button>
                <button
                  type="button"
                  className="btn-ghost tsave"
                  aria-label={t('theme.saveIn', { n })}
                  onClick={() => save({ ...theme, current: live.current, slots: theme.slots.map((s, j) => (j === i ? live.current : s)) })}
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
      {/* Where the editor's colours were (15/11): the background is what ties the two together now. */}
      <div className="set-row set-choice">
        <div className="set-l">
          <b>{t('theme.ground')}</b>
        </div>
        <div className="ttex" role="group" aria-label={t('theme.ground')}>
          {GROUNDS.map((ground) => (
            <button key={ground} type="button" aria-pressed={draft.ground === ground} onClick={() => save({ ...theme, current: { ...live.current, ground } })}>
              {t(`theme.ground.${ground}`)}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

/**
 * The theme's own violet (--link #b9a6ff, the hue of every ground): the
 * pad's middle, where the colours are untouched — the colour one sees in the
 * theme, not its coral accents (14/11).
 */
const BASE_HUE = 252;
/** Where the strength starts when a first texture is picked, and goes back on a double-click. */
const TEXTURE_START = 40;
const HUES = [-180, -120, -60, 0, 60, 120, 180].map((d) => `hsl(${BASE_HUE + d}deg 80% 68%)`).join(', ');

/**
 * The colour, picked on a pad: across, the hue turned from Koh's own violet
 * (the middle); up and down, how intense it is — untouched halfway, grey at
 * the bottom. Drag the knob, or use the arrows; a double-click puts it back.
 *
 * Only the background takes the tuning (ui/theme.ts): the pad keeps its own
 * colours. Off with the editor's background, which the tuning leaves alone.
 */
function ColorPad({
  label,
  disabled,
  tune,
  onMove,
  onCommit,
  onReset,
}: {
  label: string;
  disabled: boolean;
  tune: ThemeTune;
  onMove(change: Partial<ThemeTune>): void;
  onCommit(): void;
  onReset(): void;
}) {
  const pad = useRef<HTMLDivElement>(null);
  const at = (e: PointerEvent<HTMLDivElement>): Partial<ThemeTune> => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    const y = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
    return { hue: Math.round(x * 360 - 180), saturation: Math.round(((1 - y) * 200) / 5) * 5 };
  };
  const key = (e: KeyboardEvent<HTMLDivElement>): void => {
    const step = e.shiftKey ? 15 : 5;
    const change: Partial<ThemeTune> | undefined =
      e.key === 'ArrowLeft'
        ? { hue: Math.max(-180, tune.hue - step) }
        : e.key === 'ArrowRight'
          ? { hue: Math.min(180, tune.hue + step) }
          : e.key === 'ArrowUp'
            ? { saturation: Math.min(200, tune.saturation + step) }
            : e.key === 'ArrowDown'
              ? { saturation: Math.max(0, tune.saturation - step) }
              : undefined;
    if (change === undefined) return;
    e.preventDefault();
    onMove(change);
  };
  return (
    <div
      ref={pad}
      className="tpad"
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled}
      aria-label={label}
      aria-valuemin={-180}
      aria-valuemax={180}
      aria-valuenow={tune.hue}
      aria-valuetext={`${tune.hue > 0 ? '+' : ''}${tune.hue}° · ${tune.saturation} %`}
      onPointerDown={(e) => {
        if (disabled) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        onMove(at(e));
      }}
      onPointerMove={(e) => {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) onMove(at(e));
      }}
      onPointerUp={onCommit}
      onKeyDown={(e) => {
        if (!disabled) key(e);
      }}
      onKeyUp={(e) => {
        if (e.key.startsWith('Arrow')) onCommit();
      }}
      onDoubleClick={disabled ? undefined : onReset}
    >
      <div className="tpad-colours" style={{ backgroundImage: `linear-gradient(to bottom, transparent 0%, transparent 45%, #8a8794 100%), linear-gradient(to right, ${HUES})` }} />
      <span className="tpad-knob" style={{ left: `${((tune.hue + 180) / 360) * 100}%`, top: `${(1 - tune.saturation / 200) * 100}%` }} />
    </div>
  );
}

/** A tuning on a styled track; a double-click puts it back. */
function Slider({
  label,
  disabled = false,
  value,
  shown,
  range,
  track,
  onMove,
  onCommit,
  onReset,
}: {
  label: string;
  disabled?: boolean;
  value: number;
  shown: string;
  range: { min: number; max: number };
  track: string;
  onMove(v: number): void;
  onCommit(): void;
  onReset(): void;
}) {
  return (
    <label className="set-row tslider">
      <span className="set-l">
        <b>{label}</b>
        <span className="sub mono">{shown}</span>
      </span>
      <input
        type="range"
        className={`trange ${track}`}
        min={range.min}
        max={range.max}
        step={1}
        disabled={disabled}
        value={value}
        onChange={(e) => onMove(Number(e.target.value))}
        onPointerUp={onCommit}
        onKeyUp={onCommit}
        onBlur={onCommit}
        onDoubleClick={onReset}
      />
    </label>
  );
}

/** A kept theme's background on its swatch: Koh-Vibe's tuned, or the editor's. */
function swatchGround(slot: ThemeTune): CSSProperties {
  if (slot.ground === 'ide') {
    const bg = 'var(--vscode-sideBar-background, var(--vscode-editor-background, #14121f))';
    const fg = 'var(--vscode-foreground, #eeeaf8)';
    return {
      '--swatch-bg': bg,
      '--swatch-surface': `color-mix(in srgb, ${bg} 94%, ${fg})`,
      '--swatch-raised': `color-mix(in srgb, ${bg} 87%, ${fg})`,
      '--swatch-line': `color-mix(in srgb, ${bg} 80%, ${fg})`,
    } as CSSProperties;
  }
  const g = groundColours(slot);
  return { '--swatch-bg': g.bg, '--swatch-surface': g.surface, '--swatch-raised': g.raised, '--swatch-line': g.line } as CSSProperties;
}

/** A kept theme's textures on its swatch, at its strength. */
function swatchTexture(slot: ThemeTune): { backgroundImage?: string; backgroundSize?: string } {
  if (slot.textures.length === 0 || slot.grain === 0) return {};
  const layers = textureLayers(slot.textures);
  return { backgroundImage: layers.image, backgroundSize: layers.size };
}
