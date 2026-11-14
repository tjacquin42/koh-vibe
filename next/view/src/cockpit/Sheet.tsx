import { useState } from 'react';
import type { SessionSheetView, SheetAgentView } from '../../../src/shared/protocol';
import { formatAge, formatTokens, formatWhen, sessionDetail, sessionTitle, toneOf } from '../format';
import { countTokens } from '../sections';
import { Dot, Icon } from '../ui/icons';
import { ProcessRow } from '../views/Processes';
import { SessionName } from '../ui/SessionName';
import type { ViewCtx } from '../views/context';

/** How many calls show before « Show all ». */
const FIRST_TOOLS = 40;

/**
 * F. One conversation, everything at once: what it was last asked, the tools
 * it ran, its subagents, the files it changed, the processes it keeps — over
 * the cockpit's window. Built by the host for this conversation only.
 */
export function SessionSheet({ ctx, id, onClose }: { ctx: ViewCtx; id: string; onClose(): void }) {
  const { t, now, language, snapshot } = ctx;
  const [allTools, setAllTools] = useState(false);
  const s = snapshot.sessions.find((x) => x.id === id);
  const row = snapshot.activity?.sessions.find((x) => x.id === id);
  const sheet: SessionSheetView | undefined = snapshot.sheet?.id === id ? snapshot.sheet : undefined;
  const procs = snapshot.processes?.bySession[id] ?? [];
  const title = s !== undefined ? sessionTitle(s, t) : (row?.title ?? row?.project ?? id);
  const agentLabel = new Map((sheet?.agents ?? []).map((a) => [a.id, a.label]));
  const tools = sheet === undefined ? [] : allTools ? sheet.tools : sheet.tools.slice(0, FIRST_TOOLS);
  const ownFresh = sheet === undefined ? 0 : countTokens(sheet.tokens, 'fresh');
  const subFresh = sheet === undefined ? 0 : countTokens(sheet.subagentTokens, 'fresh');
  const all = sheet === undefined ? 0 : countTokens(sheet.tokens, 'all') + countTokens(sheet.subagentTokens, 'all');

  return (
    <div className="sheet">
      <button type="button" className="btn-ghost sheet-back" onClick={onClose}>
        <Icon name="chev" /> {t('sheet.back')}
      </button>
      <header className="sheet-head">
        <div className="sheet-t">
          {s !== undefined && <Dot tone={toneOf(s)} animate={ctx.animate} size={18} label={t(toneOf(s) === 'ended' ? 'status.ended' : `status.${s.status}`)} />}
          <h1>{s !== undefined ? <SessionName s={s} t={t} animate={ctx.animate} /> : title}</h1>
        </div>
        <p className="muted">{s !== undefined ? `${s.project}${s.branch !== undefined ? ` · ${s.branch}` : ''} · ${sessionDetail(s)}` : row?.project}</p>
        <div className="sheet-acts">
          <button type="button" className="btn-go" onClick={() => ctx.bridge.post({ type: 'openSession', sessionId: id })}>
            <Icon name="external" /> {t('sheet.goTo')}
          </button>
        </div>
      </header>

      {sheet === undefined ? (
        <p className="hint pad">{snapshot.activity === undefined ? t('cockpit.loading') : t('sheet.nothing')}</p>
      ) : (
        <>
          <div className="sheet-stats">
            <Stat n={formatTokens(ownFresh + subFresh)} label={t('sheet.stat.tokens')} sub={t('sheet.stat.tokensSub', { all: formatTokens(all), sub: formatTokens(subFresh) })} />
            <Stat n={String(sheet.toolCount)} label={t('sheet.stat.tools')} />
            <Stat n={String(sheet.agents.length)} label={t('sheet.stat.agents')} />
            <Stat n={String(sheet.files.length)} label={t('sheet.stat.files')} />
          </div>
          {sheet.lastPrompt !== undefined && (
            <div className="sheet-ask">
              <span className="muted small">{t('sheet.lastPrompt', { when: formatWhen(sheet.lastPrompt.at, now, language) })}</span>
              <p>{sheet.lastPrompt.text}</p>
            </div>
          )}
          <div className="sheet-grid">
            <section className="sheet-sec">
              <h2 className="sec">
                {t('sheet.tools')} <span className="n">{sheet.toolCount}</span>
              </h2>
              {tools.length === 0 && <p className="hint">{t('sheet.none')}</p>}
              <ol className="sheet-tools">
                {tools.map((c, i) => (
                  <li key={`${c.at}-${i}`}>
                    <span className="tm mono">{formatWhen(c.at, now, language)}</span>
                    <span className="tool mono">{c.tool}</span>
                    <span className="tx">{c.target ?? ''}</span>
                    {c.agent !== undefined && <span className="agent-tag">{short(agentLabel.get(c.agent) ?? t('sheet.agentTag'))}</span>}
                  </li>
                ))}
              </ol>
              {!allTools && sheet.tools.length > FIRST_TOOLS && (
                <button type="button" className="btn-ghost" onClick={() => setAllTools(true)}>
                  {t('sheet.showAll', { n: sheet.tools.length })}
                </button>
              )}
              {sheet.toolCount > sheet.tools.length && allTools && <p className="hint">{t('sheet.capped', { n: sheet.tools.length, total: sheet.toolCount })}</p>}
            </section>

            <div className="sheet-col">
              <section className="sheet-sec">
                <h2 className="sec">
                  {t('sheet.agents')} <span className="n">{sheet.agents.length}</span>
                </h2>
                {sheet.agents.length === 0 && <p className="hint">{t('sheet.noAgents')}</p>}
                {sheet.agents.map((a) => (
                  <AgentCard key={a.id} ctx={ctx} a={a} />
                ))}
              </section>
              <section className="sheet-sec">
                <h2 className="sec">
                  {t('sheet.files')} <span className="n">{sheet.files.length}</span>
                </h2>
                {sheet.files.length === 0 && <p className="hint">{t('sheet.noFiles')}</p>}
                <ul className="sheet-files">
                  {sheet.files.map((f) => (
                    <li key={f.path}>
                      <span className="mono path">{f.path}</span>
                      <span className="muted small">×{f.writes}</span>
                      <span className="tm">{formatAge(now - f.lastAt, t)}</span>
                    </li>
                  ))}
                </ul>
              </section>
              <section className="sheet-sec">
                <h2 className="sec">
                  {t('sheet.processes')} <span className="n">{procs.length}</span>
                </h2>
                {procs.length === 0 && <p className="hint">{t('sheet.noProcesses')}</p>}
                {procs.map((p) => (
                  <ProcessRow key={p.pid} ctx={ctx} p={p} />
                ))}
              </section>
            </div>
          </div>
          <p className="hint">{t('sheet.window')}</p>
        </>
      )}
    </div>
  );
}

/** A subagent's name, short enough for a tag on a row. */
function short(label: string): string {
  return label.length > 22 ? `${label.slice(0, 21)}…` : label;
}

function Stat({ n, label, sub }: { n: string; label: string; sub?: string }) {
  return (
    <div className="stat">
      <b>{n}</b>
      <span>{label}</span>
      {sub !== undefined && <span className="muted small">{sub}</span>}
    </div>
  );
}

function AgentCard({ ctx, a }: { ctx: ViewCtx; a: SheetAgentView }) {
  const { t, now } = ctx;
  // Without a meta file, still working means: wrote in the last two minutes.
  const running = a.finished === false || (a.finished === undefined && now - a.lastAt < 2 * 60_000);
  return (
    <div className="agent">
      <div className="agent-l1">
        <Icon name="bot" />
        <span className="ttl">{a.label}</span>
        <span className={`state ${running ? 'on' : 'off'}`}>{t(running ? 'sheet.agentRunning' : 'sheet.agentDone')}</span>
      </div>
      <span className="muted small">
        {[a.type, a.model].filter((x): x is string => x !== undefined).join(' · ')}
        {a.type !== undefined || a.model !== undefined ? ' · ' : ''}
        {t('sheet.agentLine', { tools: a.tools, tokens: formatTokens(countTokens(a.tokens, 'fresh')), age: formatAge(now - a.lastAt, t) })}
      </span>
    </div>
  );
}
