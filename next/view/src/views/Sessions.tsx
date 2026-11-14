import { useMemo, useRef, useState, type DragEvent, type HTMLAttributes } from 'react';
import { useFlip } from '../ui/flip';
import { useDragScroll } from '../ui/drag-scroll';
import { SessionName } from '../ui/SessionName';
import { Confirm, NameInput } from '../ui/Inline';
import { FOLDER_COLOR_IDS, MAX_NAME } from '../../../src/shared/actions';
import type { ClosedView, FolderView, SessionView } from '../../../src/shared/protocol';
import { formatAge, formatTokens, formatWhen, sessionActivity, toneOf } from '../format';
import { Dot, Icon } from '../ui/icons';
import { Section } from '../ui/Section';
import { Inbox } from '../cockpit/Cockpit';
import { dropOrder } from '../sections';
import { FOLDER_COLORS } from '../ui/colors';
import type { ViewCtx } from './context';


/** What is being dragged in the Sessions tab. */
type Drag = { kind: 'session'; id: string } | { kind: 'folder'; id: string };

/** The unfiled list's key, as a drop target and a fold key — never a folder id (V1 writes UUIDs). */
const UNFILED = 'unfiled';

export function SessionsTab({ ctx }: { ctx: ViewCtx }) {
  const { t, snapshot } = ctx;
  const byId = useMemo(() => new Map(snapshot.sessions.map((s) => [s.id, s])), [snapshot.sessions]);
  const closed = snapshot.closed.filter((c) => !byId.has(c.sessionId));
  const [drag, setDrag] = useState<Drag | undefined>();
  // Rows slide to where they now belong (ui/flip.ts) — under the Animations setting.
  const root = useRef<HTMLDivElement>(null);
  useFlip(root, ctx.animate);
  // Dragging near the list's top or bottom edge scrolls it (ui/drag-scroll.ts).
  useDragScroll(root, drag !== undefined);
  if (snapshot.sessions.length === 0 && closed.length === 0 && snapshot.folders.length === 0) {
    return (
      <div className="empty">
        <h2>{t('empty.title')}</h2>
        <p>{t('empty.body')}</p>
        <NewFolder ctx={ctx} />
      </div>
    );
  }
  const unfiled: FolderView = { id: UNFILED, name: t('folder.temporary'), sessionIds: snapshot.unfiled };
  const dnd: Dnd = { drag, setDrag };
  return (
    <div ref={root} className="flip-root">
      <Inbox ctx={ctx} compact />
      {snapshot.folders.map((f) => (
        <FolderSection key={f.id} ctx={ctx} f={f} byId={byId} dnd={dnd} />
      ))}
      <NewFolder ctx={ctx} />
      {(unfiled.sessionIds.length > 0 || drag?.kind === 'session') && <FolderSection ctx={ctx} f={unfiled} byId={byId} dnd={dnd} />}
      <Section
        title={t('closed.title')}
        count={closed.length}
        marker={<Icon name="history" size={13} />}
        folded={ctx.isFolded('closed')}
        onToggle={() => ctx.toggle('closed')}
        headProps={{ 'data-flip-anchor': 'closed', 'data-flip-folded': String(ctx.isFolded('closed')) }}
      >
        {closed.length === 0 ? <p className="hint">{t('closed.none')}</p> : closed.map((c) => <ClosedRow key={c.sessionId} ctx={ctx} c={c} />)}
      </Section>
    </div>
  );
}

interface Dnd {
  drag: Drag | undefined;
  setDrag(d: Drag | undefined): void;
}

/**
 * One folder — or the unfiled list — with its menu and its drop targets.
 *
 * A conversation dropped on a row lands in front of it, dropped anywhere
 * else in the section it lands at the end; dropped on the unfiled list it
 * leaves its folder. A folder dragged by its heading lands in front of the
 * folder it is dropped on. Each drop is one write (actions.ts).
 */
function FolderSection({ ctx, f, byId, dnd }: { ctx: ViewCtx; f: FolderView; byId: ReadonlyMap<string, SessionView>; dnd: Dnd }) {
  const { t } = ctx;
  const real = f.id !== UNFILED;
  const [menu, setMenu] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [over, setOver] = useState<string | undefined>();
  const { drag, setDrag } = dnd;
  const sessions = f.sessionIds.map((id) => byId.get(id)).filter((s): s is SessionView => s !== undefined);

  const fileHere = (id: string, before?: string): void => {
    const order = dropOrder(f.sessionIds, [id], before);
    void ctx.act(real ? { kind: 'session.file', ids: [id], folder: f.id, order } : { kind: 'session.file', ids: [id], order });
  };
  const accepts = drag !== undefined && (drag.kind === 'session' || (real && drag.id !== f.id));
  const end = (): void => {
    setDrag(undefined);
    setOver(undefined);
  };
  const sectionProps = {
    onDragOver: (e: DragEvent) => {
      if (!accepts) return;
      e.preventDefault();
      if (over === undefined) setOver('end');
    },
    onDragLeave: (e: DragEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(undefined);
    },
    onDrop: (e: DragEvent) => {
      if (!accepts || drag === undefined) return;
      e.preventDefault();
      if (drag.kind === 'session') fileHere(drag.id);
      else void ctx.act({ kind: 'folder.move', ids: [drag.id], before: f.id });
      end();
    },
  };
  const live = sessions.filter((x) => x.endedAt === undefined);
  const ended = sessions.filter((x) => x.endedAt !== undefined);
  const endedKey = `${f.id}:ended`;
  const endedFolded = ctx.isFolded(endedKey);
  // Opening a folder that holds only sleeping conversations opens them too:
  // a folder that unfolds onto one closed line has shown nothing (14/11).
  const toggleFolder = (): void => {
    const opening = ctx.isFolded(f.id);
    ctx.toggle(f.id);
    if (opening && live.length === 0 && ended.length > 0 && endedFolded) ctx.toggle(endedKey);
  };
  const row = (parent: string) => (s: SessionView) => (
    <div
      key={s.id}
      data-flip={s.id}
      data-flip-parent={parent}
      className={`drag-row${over === s.id && drag?.kind === 'session' ? ' drop-line' : ''}${drag?.kind === 'session' && drag.id === s.id ? ' dragging' : ''}`}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', s.id);
        setDrag({ kind: 'session', id: s.id });
      }}
      onDragEnd={end}
      onDragOver={(e) => {
        if (drag?.kind !== 'session') return;
        e.preventDefault();
        e.stopPropagation();
        if (over !== s.id) setOver(s.id);
      }}
      onDrop={(e) => {
        if (drag?.kind !== 'session') return;
        e.preventDefault();
        e.stopPropagation();
        fileHere(drag.id, s.id);
        end();
      }}
    >
      <SessionRow ctx={ctx} s={s} />
    </div>
  );
  const color = f.color !== undefined ? FOLDER_COLORS[f.color] : undefined;
  const title = renaming ? (
    <NameInput
      initial={f.name}
      max={MAX_NAME}
      label={t('folder.rename')}
      onDone={(name) => {
        setRenaming(false);
        if (name !== undefined && name !== f.name) void ctx.act({ kind: 'folder.rename', id: f.id, name });
      }}
    />
  ) : (
    f.name
  );
  return (
    <Section
      className={`folder${over !== undefined ? (drag?.kind === 'folder' ? ' drop-before' : ' drop-in') : ''}${ctx.isBusy(`new:${f.id}`) ? ' busy' : ''}`}
      title={title}
      count={f.sessionIds.length}
      marker={real ? <span className="fold" style={{ background: color ?? 'var(--line)' }} /> : <Icon name="hourglass" size={13} />}
      folded={ctx.isFolded(f.id) && !renaming}
      {...(renaming ? {} : { onToggle: toggleFolder })}
      sectionProps={sectionProps as HTMLAttributes<HTMLElement>}
      headProps={
        real && !renaming
          ? {
              'data-flip-anchor': f.id,
              'data-flip-folded': String(ctx.isFolded(f.id)),
              draggable: true,
              onDragStart: (e) => {
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', f.name);
                setDrag({ kind: 'folder', id: f.id });
              },
              onDragEnd: end,
            }
          : { 'data-flip-anchor': f.id, 'data-flip-folded': String(ctx.isFolded(f.id)) }
      }
      tools={
        <>
          {/* At the row's end: a new conversation, filed right here (14/11). */}
          <button
            type="button"
            className="tbtn"
            aria-label={real ? t('folder.newSessionIn', { name: f.name }) : t('action.newSession')}
            onClick={() => void ctx.track(`new:${f.id}`, ctx.act(real ? { kind: 'session.new', folder: f.id } : { kind: 'session.new' }), 4_000)}
          >
            <Icon name="plus" />
          </button>
          {real && (
            <button type="button" className="tbtn" aria-label={t('folder.menu', { name: f.name })} aria-expanded={menu} onClick={() => setMenu((v) => !v)}>
              <Icon name="more" />
            </button>
          )}
        </>
      }
    >
      {menu && real && !confirming && (
        <div className="fmenu" role="group" aria-label={t('folder.menu', { name: f.name })}>
          <button type="button" className="fm-btn" onClick={() => { setMenu(false); void ctx.act({ kind: 'session.new', folder: f.id }); }}>
            <Icon name="plus" /> {t('folder.newSession')}
          </button>
          <button type="button" className="fm-btn" onClick={() => { setMenu(false); setRenaming(true); }}>
            <Icon name="edit" /> {t('folder.rename')}
          </button>
          <button type="button" className="fm-btn" onClick={() => { setMenu(false); void ctx.act({ kind: 'folder.rules', id: f.id, mode: 'add' }); }}>
            <Icon name="chat" /> {t('folder.addRule')}
          </button>
          <button type="button" className="fm-btn" onClick={() => { setMenu(false); void ctx.act({ kind: 'folder.rules', id: f.id, mode: 'open' }); }}>
            <Icon name="doc" /> {t('folder.openRules')}
          </button>
          <div className="swatches" role="radiogroup" aria-label={t('folder.color')}>
            <button type="button" role="radio" aria-checked={f.color === undefined} aria-label={t('folder.noColor')} className="sw none" onClick={() => void ctx.act({ kind: 'folder.color', id: f.id, color: null })} />
            {FOLDER_COLOR_IDS.map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={f.color === c}
                aria-label={c}
                className="sw"
                style={{ background: FOLDER_COLORS[c] }}
                onClick={() => void ctx.act({ kind: 'folder.color', id: f.id, color: c })}
              />
            ))}
          </div>
          <button type="button" className="fm-btn danger" onClick={() => setConfirming(true)}>
            <Icon name="trash" /> {t('folder.delete')}
          </button>
        </div>
      )}
      {confirming && (
        <Confirm
          danger
          yes={t('folder.delete')}
          no={t('action.cancel')}
          onYes={() => {
            setConfirming(false);
            setMenu(false);
            void ctx.act({ kind: 'folder.delete', id: f.id });
          }}
          onNo={() => setConfirming(false)}
        >
          {t('folder.deleteConfirm', { name: f.name, n: f.sessionIds.length })}
        </Confirm>
      )}
      {sessions.length === 0 && <p className="hint drop-hint">{t('folder.empty')}</p>}
      {live.map(row(f.id))}
      {ended.length > 0 && (
        // The closed ones, under the others: one icon and a count, no words, set a little to the right.
        <div className="ended-group">
          <button type="button" className="ended-head" data-flip-anchor={endedKey} data-flip-folded={String(endedFolded)} aria-expanded={!endedFolded} aria-label={t('folder.ended', { n: ended.length })} onClick={() => ctx.toggle(endedKey)}>
            <Icon name={endedFolded ? 'chevR' : 'chev'} />
            <Dot tone="ended" animate={false} size={13} />
            <span className="n">{ended.length}</span>
          </button>
          {!endedFolded && ended.map(row(endedKey))}
        </div>
      )}
    </Section>
  );
}

function NewFolder({ ctx }: { ctx: ViewCtx }) {
  const { t } = ctx;
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button type="button" className="new-folder" onClick={() => setOpen(true)}>
        <Icon name="plus" /> {t('folder.new')}
      </button>
    );
  }
  return (
    <div className="new-folder open">
      <Icon name="plus" />
      <NameInput
        initial=""
        max={MAX_NAME}
        label={t('folder.new')}
        onDone={(name) => {
          setOpen(false);
          if (name !== undefined) void ctx.act({ kind: 'folder.create', name });
        }}
      />
    </div>
  );
}

export function SessionRow({ ctx, s }: { ctx: ViewCtx; s: SessionView }) {
  const { t, now } = ctx;
  const [info, setInfo] = useState(false);
  const tone = toneOf(s);
  const statusKey = tone === 'ended' ? 'status.ended' : (`status.${s.status}` as const);
  const expiring = s.expiresAt !== undefined && s.expiresAt - now < 6 * 3_600_000;
  const busy = ctx.isBusy(s.id);
  // A second line only when it says something: a permission, the tool running, a departure soon.
  const doing = s.endedAt === undefined ? sessionActivity(s) : undefined;
  return (
    <div className={`srow tone-${tone}${info ? ' open' : ''}${busy ? ' busy' : ''}`} aria-busy={busy}>
      <div className="srow-line">
        <button
          type="button"
          className="srow-main"
          onClick={() => {
            // V1 brings the tab forward and says nothing back: a short beat of « on it ».
            void ctx.track(s.id, Promise.resolve(), 900);
            ctx.bridge.post({ type: 'openSession', sessionId: s.id });
          }}
        >
          {busy ? <span className="spinner" aria-hidden="true" /> : <Dot tone={tone} animate={ctx.animate} label={t(statusKey)} />}
          <span className="txt">
            <span className="l1">
              <span className="ttl">
                <SessionName s={s} t={t} animate={ctx.animate} />
              </span>
              <span className="tm">{formatAge(now - (s.endedAt ?? s.lastEventAt), t)}</span>
            </span>
            {(doing !== undefined || expiring) && (
              <span className="l2">
                {doing}
                {expiring && s.expiresAt !== undefined && (
                  <span className="exp">
                    {doing !== undefined ? ' · ' : ''}
                    {t('session.expires', { d: formatAge(Math.max(0, s.expiresAt - now), t) })}
                  </span>
                )}
              </span>
            )}
          </span>
        </button>
        <span className="tools">
          {/* V1 asks before putting to sleep or closing a conversation that still works. */}
          {s.endedAt === undefined && (
            <button type="button" className="tbtn hover-only" aria-label={t('row.sleep')} onClick={() => void ctx.track(s.id, ctx.act({ kind: 'session.command', command: 'sleep', id: s.id }))}>
              <Icon name="moon" />
            </button>
          )}
          <button type="button" className="tbtn hover-only" aria-label={t('row.close')} onClick={() => void ctx.track(s.id, ctx.act({ kind: 'session.command', command: 'close', id: s.id }))}>
            <Icon name="trash" />
          </button>
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
          <Icon name="panel" /> {t('row.sheet')}
        </button>
        <button type="button" className="btn-ghost" onClick={() => void ctx.act({ kind: 'session.copyId', id: s.id })}>
          <Icon name="copy" /> {t('row.copyId')}
        </button>
      </div>
    </dl>
  );
}

export function ClosedRow({ ctx, c }: { ctx: ViewCtx; c: ClosedView }) {
  const { t, now } = ctx;
  const title = c.title ?? c.project;
  const age = <span className="tm">{formatAge(now - c.closedAt, t)}</span>;
  if (!c.resumable) {
    // Started outside the editor and the terminal: V1 has nothing to resume it from.
    return (
      <div className="row closed-row" data-flip={c.sessionId} data-flip-parent="closed">
        <Dot tone="ended" animate={false} />
        <span className="txt">
          <span className="ttl">{title}</span>
          <span className="sub">{t('closed.elsewhere')}</span>
        </span>
        {age}
      </div>
    );
  }
  const waiting = ctx.reopening.has(c.sessionId);
  const notice = ctx.reopenNotice(c.sessionId);
  return (
    <div className="closed-item" data-flip={c.sessionId} data-flip-parent="closed">
      <button
        type="button"
        className="row row-btn closed-row"
        disabled={waiting}
        aria-busy={waiting}
        aria-label={`${title} — ${t('closed.reopen')}`}
        onClick={() => ctx.reopen(c.sessionId)}
      >
        <Dot tone={waiting ? 'run' : 'ended'} animate={ctx.animate} />
        <span className="ttl">{title}</span>
        {waiting ? <span className="tm busy">{t('closed.reopening')}</span> : age}
        {!waiting && (
          <span className="go">
            <Icon name="resume" size={12} />
          </span>
        )}
      </button>
      {notice !== undefined && (
        <p className="notice" role="status">
          {t(`closed.${notice}`)}
        </p>
      )}
    </div>
  );
}
