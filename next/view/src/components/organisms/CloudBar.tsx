import { useState } from 'react';
import type { ViewCtx } from '../../context';
import { formatAge } from '../../format';
import { Icon } from '../atoms/Icon';
import { IconButton } from '../atoms/IconButton';
import { Popover } from '../molecules/Popover';
import { TidyRules } from '../molecules/TidyRules';

/**
 * How old the list from claude.ai is, and a button to ask again now. The list
 * is otherwise asked at most every five minutes, whichever window asks.
 */
export function CloudBar({ ctx, what, at }: { ctx: ViewCtx; what: 'artifacts' | 'routines'; at: number | undefined }) {
  const { t, now, snapshot } = ctx;
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  const [rules, setRules] = useState(false);
  const tidy = what === 'artifacts' ? snapshot.tidy : undefined;
  const refresh = (): void => {
    setBusy(true);
    void ctx.act({ kind: 'cloud.refresh', what }).finally(() => setBusy(false));
  };
  // The tidying agent (host tidy.ts): it reads the list again itself, then files.
  const runTidy = (): void => {
    setBusy(true);
    void ctx
      .track('tidy', ctx.act({ kind: 'artifact.tidy' }), 1_000)
      .then((r) => {
        if (r.ok) ctx.notify(r.count === undefined || r.count === 0 ? t('tidy.none') : t('tidy.done', { n: r.count }));
      })
      .finally(() => setBusy(false));
  };
  const tidying = ctx.isBusy('tidy');
  const working = busy || tidying;
  const label = tidying ? t('tidy.running') : busy ? t('cloud.refreshing') : tidy !== undefined ? t('tidy.button') : t('cloud.refresh');
  return (
    <div className="cloudbar">
      <span>{at === undefined ? t('cloud.never') : t('cloud.age', { age: formatAge(now - at, t) })}</span>
      <span className="cloudbar-act">
        <button
          type="button"
          className={`btn-ghost${working ? ' busy' : ''}`}
          disabled={working}
          aria-busy={working}
          aria-expanded={asking}
          onClick={() => {
            if (tidy === undefined) refresh();
            else if (tidy.ask) setAsking(true);
            else runTidy();
          }}
        >
          <Icon name={tidy !== undefined ? 'tidy' : 'resume'} /> {label}
        </button>
        {/* The tidying rules, at hand where they serve (15/11) — no longer in the settings. */}
        {tidy !== undefined && <IconButton icon="doc" label={t('tidy.rulesTitle')} expanded={rules} onClick={() => setRules((r) => !r)} />}
        {rules && tidy !== undefined && (
          <Popover label={t('tidy.rulesTitle')} onClose={() => setRules(false)}>
            <div className="pop-body">
              <b className="pop-title">{t('tidy.rulesTitle')}</b>
              <TidyRules
                t={t}
                rules={tidy.rules}
                onAdd={() => {
                  setRules(false);
                  void ctx.act({ kind: 'tidy.rules', mode: 'add' });
                }}
                onOpen={() => {
                  setRules(false);
                  void ctx.act({ kind: 'tidy.rules', mode: 'open' });
                }}
              />
            </div>
          </Popover>
        )}
        {asking && tidy !== undefined && (
          <Popover label={t('tidy.title')} onClose={() => setAsking(false)}>
            <TidyAsk
              ctx={ctx}
              rules={tidy.rules}
              onRun={(dontAsk) => {
                setAsking(false);
                if (dontAsk) void ctx.act({ kind: 'tidy.settings', ask: false });
                runTidy();
              }}
              onAddRule={() => {
                setAsking(false);
                void ctx.act({ kind: 'tidy.rules', mode: 'add' });
              }}
              onOpenRules={() => {
                setAsking(false);
                void ctx.act({ kind: 'tidy.rules', mode: 'open' });
              }}
              onListOnly={() => {
                setAsking(false);
                refresh();
              }}
              onCancel={() => setAsking(false)}
            />
          </Popover>
        )}
      </span>
    </div>
  );
}

/**
 * Asked before the tidying agent runs (14/11): what it does, its rules — a
 * conversation adds one, as for a folder — and « don't ask again », undone
 * from the settings.
 */
function TidyAsk({
  ctx,
  rules,
  onRun,
  onAddRule,
  onOpenRules,
  onListOnly,
  onCancel,
}: {
  ctx: ViewCtx;
  rules: readonly string[];
  onRun(dontAsk: boolean): void;
  onAddRule(): void;
  onOpenRules(): void;
  onListOnly(): void;
  onCancel(): void;
}) {
  const { t } = ctx;
  const [dontAsk, setDontAsk] = useState(false);
  return (
    <div className="confirm calm tidy-ask">
      <p>
        <b>{t('tidy.title')}</b>
      </p>
      <p>{t('tidy.explain')}</p>
      <p className="muted small">{t('tidy.rules')}</p>
      <TidyRules t={t} rules={rules} onAdd={onAddRule} onOpen={onOpenRules} />
      <label className="check">
        <input type="checkbox" checked={dontAsk} onChange={(e) => setDontAsk(e.target.checked)} />
        <span>{t('tidy.dontAsk')}</span>
      </label>
      <div className="confirm-btns">
        <button type="button" className="btn-go" onClick={() => onRun(dontAsk)}>
          {t('tidy.run')}
        </button>
        <button type="button" className="btn-ghost" onClick={onListOnly}>
          {t('tidy.listOnly')}
        </button>
        <button type="button" className="btn-ghost" onClick={onCancel}>
          {t('action.cancel')}
        </button>
      </div>
    </div>
  );
}
