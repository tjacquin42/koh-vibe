import { useMemo, useState } from 'react';
import type { ClosedView, FolderView, SessionView } from '../../../src/shared/protocol';
import { formatAge, formatTokens, formatWhen, sessionDetail, sessionTitle, toneOf } from '../format';
import { Dot, Icon } from '../ui/icons';
import { Section } from '../ui/Section';
import type { ViewCtx } from './context';

/** V1's neutral folder colors, drawn from the Koh palette. Unknown ids show no color. */
export const FOLDER_COLORS: Record<string, string> = {
  blue: '#5CC8F0',
  indigo: '#8A9BFF',
  cyan: '#6FE3E0',
  green: '#7EE0A8',
  lime: '#C3EB7A',
  yellow: '#F5D06B',
  orange: '#FF9E5E',
  red: '#FF7A7A',
  pink: '#F59AC8',
  purple: '#B9A6FF',
};

export function SessionsTab({ ctx }: { ctx: ViewCtx }) {
  const { t, snapshot } = ctx;
  const byId = useMemo(() => new Map(snapshot.sessions.map((s) => [s.id, s])), [snapshot.sessions]);
  const closed = snapshot.closed.filter((c) => !byId.has(c.sessionId));
  if (snapshot.sessions.length === 0 && closed.length === 0) {
    return (
      <div className="empty">
        <h2>{t('empty.title')}</h2>
        <p>{t('empty.body')}</p>
      </div>
    );
  }
  const unfiled: FolderView = { id: 'unfiled', name: t('folder.temporary'), sessionIds: snapshot.unfiled };
  return (
    <>
      {[...snapshot.folders, unfiled]
        .filter((f) => f.sessionIds.length > 0)
        .map((f) => (
          <Section
            key={f.id}
            title={f.name}
            count={f.sessionIds.length}
            marker={<span className="fold" style={{ background: (f.color !== undefined ? FOLDER_COLORS[f.color] : undefined) ?? 'var(--line)' }} />}
            folded={ctx.isFolded(f.id)}
            onToggle={() => ctx.toggle(f.id)}
          >
            {f.sessionIds
              .map((id) => byId.get(id))
              .filter((s): s is SessionView => s !== undefined)
              .map((s) => (
                <SessionRow key={s.id} ctx={ctx} s={s} />
              ))}
          </Section>
        ))}
      <Section title={t('closed.title')} count={closed.length} folded={ctx.isFolded('closed')} onToggle={() => ctx.toggle('closed')}>
        {closed.length === 0 ? <p className="hint">{t('closed.none')}</p> : closed.map((c) => <ClosedRow key={c.sessionId} ctx={ctx} c={c} />)}
      </Section>
    </>
  );
}

export function SessionRow({ ctx, s }: { ctx: ViewCtx; s: SessionView }) {
  const { t, now } = ctx;
  const [info, setInfo] = useState(false);
  const tone = toneOf(s);
  const statusKey = tone === 'ended' ? 'status.ended' : (`status.${s.status}` as const);
  const tokens = s.tokens === undefined ? undefined : formatTokens(s.tokens.input + s.tokens.output);
  const expiring = s.expiresAt !== undefined && s.expiresAt - now < 6 * 3_600_000;
  return (
    <div className={`srow tone-${tone}${info ? ' open' : ''}`}>
      <div className="srow-line">
        <button type="button" className="srow-main" onClick={() => ctx.bridge.post({ type: 'openCockpit', sessionId: s.id })}>
          <Dot tone={tone} animate={ctx.animate} label={t(statusKey)} />
          <span className="txt">
            <span className="l1">
              <span className="ttl">{sessionTitle(s, t)}</span>
              <span className="tm">{formatAge(now - (s.endedAt ?? s.lastEventAt), t)}</span>
            </span>
            <span className="l2">
              {sessionDetail(s)}
              {tokens !== undefined && <span> · {tokens}</span>}
              {expiring && s.expiresAt !== undefined && <span className="exp"> · {t('session.expires', { d: formatAge(Math.max(0, s.expiresAt - now), t) })}</span>}
            </span>
          </span>
        </button>
        <span className="tools">
          <button type="button" className="tbtn" aria-label={t('info.button')} aria-expanded={info} aria-pressed={info} onClick={() => setInfo((v) => !v)}>
            <Icon name="info" />
          </button>
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
  if (s.currentAction !== undefined && s.status === 'running') {
    rows.push([t('info.doing'), s.currentAction.target !== undefined ? `${s.currentAction.tool} ${s.currentAction.target}` : s.currentAction.tool]);
  }
  if (s.tokens !== undefined) rows.push([t('info.tokens'), t('info.tokensValue', { in: formatTokens(s.tokens.input), out: formatTokens(s.tokens.output) })]);
  rows.push([t('info.tools'), String(s.toolCount)]);
  if (s.startedAt !== undefined) rows.push([t('info.started'), formatWhen(s.startedAt, now, language)]);
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
    </dl>
  );
}

export function ClosedRow({ ctx, c }: { ctx: ViewCtx; c: ClosedView }) {
  return (
    <div className="row">
      <Dot tone="ended" animate={false} />
      <span className="ttl">{c.title ?? c.project}</span>
      <span className="tm">{formatAge(ctx.now - c.closedAt, ctx.t)}</span>
    </div>
  );
}
