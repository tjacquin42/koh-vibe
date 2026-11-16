import { useState } from 'react';
import type { SessionView } from '../../../../src/shared/protocol';
import type { ViewCtx } from '../../context';
import { formatAge, formatTokens, formatWhen, isFiled, isQuietTool, toneOf, toolLabel } from '../../format';
import { cx } from '../../lib/cx';
import { menuContext } from '../../lib/menu-context';
import { Dot, Icon } from '../atoms/Icon';
import { IconButton } from '../atoms/IconButton';
import { SessionName } from '../atoms/SessionName';

/** What a right-click on a conversation offers, wherever it shows (host menus.ts). */
export function sessionContext(ctx: ViewCtx, id: string, ended: boolean): string {
  return menuContext('kvnSession', { kvnSessionId: id, kvnEnded: ended, kvnFiled: isFiled(ctx.where, id) });
}

/** A conversation on one line (14/11): what it does and when it leaves are behind the (i). */
export function SessionRow({ ctx, s }: { ctx: ViewCtx; s: SessionView }) {
  const { t, now } = ctx;
  const [info, setInfo] = useState(false);
  const tone = toneOf(s);
  const statusKey = tone === 'ended' ? 'status.ended' : (`status.${s.status}` as const);
  const busy = ctx.isBusy(s.id) || ctx.reopening.has(s.id);
  const active = ctx.activeId === s.id;
  const command = (what: 'sleep' | 'close'): void => void ctx.track(s.id, ctx.act({ kind: 'session.command', command: what, id: s.id }));
  return (
    <div
      className={cx('srow', `tone-${tone}`, info && 'open', busy && 'busy', active && 'active')}
      aria-busy={busy}
      aria-current={active ? 'true' : undefined}
      data-session={s.id}
      data-vscode-context={sessionContext(ctx, s.id, s.endedAt !== undefined)}
    >
      <div className="srow-line">
        <button
          type="button"
          className="srow-main"
          onClick={() => {
            // The row spins until the click has had its whole effect (15/11):
            // the conversation open, and its tab in front when it lives in the
            // editor. Never less than a beat, even when it is in front already.
            void ctx.track(s.id, Promise.resolve(), 600);
            ctx.open(s.id);
          }}
        >
          {busy ? <span className="spinner" aria-hidden="true" /> : <Dot tone={tone} animate={ctx.animate} label={t(statusKey)} />}
          <span className="txt">
            <span className="l1">
              <span className="ttl conv-ttl">
                <SessionName s={s} t={t} animate={ctx.animate} />
              </span>
              <span className="tm">{formatAge(now - (s.endedAt ?? s.lastEventAt), t)}</span>
            </span>
          </span>
        </button>
        <span className="tools">
          {/* V1 asks before putting to sleep or closing a conversation that still works. */}
          {/* Only in a folder: one in no folder is closed, never put to sleep (15/11). */}
          {s.endedAt === undefined && isFiled(ctx.where, s.id) && <IconButton icon="moon" label={t('row.sleep')} className="hover-only" onClick={() => command('sleep')} />}
          <IconButton icon="trash" label={t('row.close')} className="hover-only" onClick={() => command('close')} />
          <IconButton icon="info" label={t('info.button')} expanded={info} pressed={info} onClick={() => setInfo((v) => !v)} />
        </span>
      </div>
      {info && <SessionInfo ctx={ctx} s={s} />}
    </div>
  );
}

/** Behind the (i): what used to be the tooltip, decided in the triage. */
function SessionInfo({ ctx, s }: { ctx: ViewCtx; s: SessionView }) {
  const { t, now, language } = ctx;
  const rows: [string, string][] = [[t('info.project'), s.project]];
  if (s.branch !== undefined) rows.push([t('info.branch'), s.branch]);
  rows.push([t('info.where'), t(`origin.${s.origin}`)]);
  if (s.currentAction !== undefined && s.status === 'running' && !isQuietTool(s.currentAction.tool)) {
    rows.push([t('info.doing'), s.currentAction.target !== undefined ? `${toolLabel(s.currentAction.tool)} ${s.currentAction.target}` : toolLabel(s.currentAction.tool)]);
  }
  if (s.tokens !== undefined) rows.push([t('info.tokens'), t('info.tokensValue', { in: formatTokens(s.tokens.input), out: formatTokens(s.tokens.output) })]);
  rows.push([t('info.tools'), String(s.toolCount)]);
  if (s.endedAt !== undefined) rows.push([t('info.ended'), formatWhen(s.endedAt, now, language)]);
  if (s.expiresAt !== undefined) rows.push([t('info.expires'), formatWhen(s.expiresAt, now, language)]);
  return (
    <dl className="info">
      {rows.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
      <div className="info-acts">
        <button type="button" className="btn-ghost" onClick={() => ctx.bridge.post({ type: 'openCockpit', sessionId: s.id })}>
          <Icon name="sheet" /> {t('row.sheet')}
        </button>
        <button type="button" className="btn-ghost" onClick={() => void ctx.act({ kind: 'session.copyId', id: s.id })}>
          <Icon name="copy" /> {t('row.copyId')}
        </button>
      </div>
    </dl>
  );
}
