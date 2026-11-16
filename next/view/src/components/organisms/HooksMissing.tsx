import type { ViewCtx } from '../../context';

/**
 * Claude Code's settings hold no Koh-Vibe hook: no conversation can show up.
 * Said first, with the one button that fixes it — V1's installer, which shows
 * what it does in a terminal and backs the settings up first.
 */
export function HooksMissing({ ctx }: { ctx: ViewCtx }) {
  const { t } = ctx;
  const busy = ctx.isBusy('hooks');
  return (
    <div className="hooks-missing" role="alert">
      <p>
        <b>{t('hooks.missing.title')}</b>
      </p>
      <p className="muted small">{t('hooks.missing.body')}</p>
      <button type="button" className={`btn-go${busy ? ' busy' : ''}`} onClick={() => void ctx.track('hooks', ctx.act({ kind: 'hooks.install' }), 3_000)}>
        {t('hooks.missing.install')}
      </button>
    </div>
  );
}
