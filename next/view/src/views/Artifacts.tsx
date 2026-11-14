import { useState } from 'react';
import { MAX_NAME, MAX_TITLE } from '../../../src/shared/actions';
import type { ArtifactView } from '../../../src/shared/protocol';
import { artifactSections } from '../sections';
import { formatAge } from '../format';
import { Icon } from '../ui/icons';
import { Confirm, NameInput } from '../ui/Inline';
import { Popover } from '../ui/Popover';
import { RulesEditor } from '../ui/Rules';
import { Section } from '../ui/Section';
import { menuContext } from '../ui/menu-context';
import type { ViewCtx } from './context';

export function ArtifactsTab({ ctx }: { ctx: ViewCtx }) {
  const { t, snapshot } = ctx;
  const items = snapshot.artifacts?.items ?? [];
  const bar = <CloudBar ctx={ctx} what="artifacts" at={snapshot.artifacts?.at} />;
  if (items.length === 0) {
    return (
      <>
        {bar}
        <p className="hint pad">{t('artifacts.none')}</p>
      </>
    );
  }
  const s = artifactSections(items);
  return (
    <>
      {bar}
      {s.pinned.length > 0 && (
        <Section title={t('artifacts.pinned')} count={s.pinned.length} marker={<Icon name="pin" size={13} />}>
          {s.pinned.map((a) => (
            <ArtifactRow key={a.slug} ctx={ctx} a={a} />
          ))}
        </Section>
      )}
      <Section title={t('artifacts.recent')} count={s.recent.length}>
        {s.recent.map((a) => (
          <ArtifactRow key={a.slug} ctx={ctx} a={a} />
        ))}
      </Section>
      <h2 className="sec sec-label">{t('artifacts.byProject')}</h2>
      {s.projects.map((p) => {
        const key = `proj:${p.project ?? ''}`;
        // Projects start folded: the list is long and « Recent » already shows what is fresh.
        const folded = !ctx.isFolded(key);
        return (
          <Section key={key} title={p.project ?? t('artifacts.other')} count={p.items.length} folded={folded} onToggle={() => ctx.toggle(key)}>
            {p.items.map((a) => (
              <ArtifactRow key={a.slug} ctx={ctx} a={a} />
            ))}
          </Section>
        );
      })}
      <datalist id="artifact-projects">
        {[...new Set(items.map((a) => a.project).filter((p): p is string => p !== undefined))].sort().map((p) => (
          <option key={p} value={p} />
        ))}
      </datalist>
    </>
  );
}

/**
 * How old the list from claude.ai is, and a button to ask again now. The list
 * is otherwise asked at most every five minutes, whichever window asks.
 */
export function CloudBar({ ctx, what, at }: { ctx: ViewCtx; what: 'artifacts' | 'routines'; at: number | undefined }) {
  const { t, now, snapshot } = ctx;
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
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
  const working = busy || ctx.isBusy('tidy');
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
          <Icon name="resume" /> {working ? (tidy !== undefined ? t('tidy.running') : t('cloud.refreshing')) : t('cloud.refresh')}
        </button>
        {asking && tidy !== undefined && (
          <Popover label={t('tidy.title')} onClose={() => setAsking(false)}>
            <TidyAsk
              ctx={ctx}
              rules={tidy.rules}
              onRun={(dontAsk, rules) => {
                setAsking(false);
                void ctx.act({ kind: 'tidy.settings', ask: !dontAsk, rules }).then(runTidy);
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
 * Asked before the tidying agent runs (14/11): what it does, its rules — to
 * add to on the spot — and « don't ask again », undone from the settings.
 */
function TidyAsk({
  ctx,
  rules: initial,
  onRun,
  onListOnly,
  onCancel,
}: {
  ctx: ViewCtx;
  rules: readonly string[];
  onRun(dontAsk: boolean, rules: string[]): void;
  onListOnly(): void;
  onCancel(): void;
}) {
  const { t } = ctx;
  const [rules, setRules] = useState<string[]>([...initial]);
  const [dontAsk, setDontAsk] = useState(false);
  return (
    <div className="confirm calm tidy-ask">
      <p>
        <b>{t('tidy.title')}</b>
      </p>
      <p>{t('tidy.explain')}</p>
      <p className="muted small">{t('tidy.rules')}</p>
      <RulesEditor t={t} rules={rules} onChange={setRules} />
      <label className="check">
        <input type="checkbox" checked={dontAsk} onChange={(e) => setDontAsk(e.target.checked)} />
        <span>{t('tidy.dontAsk')}</span>
      </label>
      <div className="confirm-btns">
        <button type="button" className="btn-go" onClick={() => onRun(dontAsk, rules)}>
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

type Panel = 'menu' | 'rename' | 'project' | 'folder' | 'delete';

export function ArtifactRow({ ctx, a }: { ctx: ViewCtx; a: ArtifactView }) {
  const { t, now, snapshot } = ctx;
  const [panel, setPanel] = useState<Panel | undefined>();
  const name = a.title || t('artifacts.untitled');
  const close = (): void => setPanel(undefined);
  return (
    <div
      className={`arow${panel !== undefined ? ' open' : ''}${ctx.isBusy(a.slug) ? ' busy' : ''}`}
      aria-busy={ctx.isBusy(a.slug)}
      data-vscode-context={menuContext('kvnArtifact', { kvnSlug: a.slug, kvnTitle: a.title, kvnPinned: a.pinned })}
    >
      <div className="arow-line">
        {panel === 'rename' ? (
          <span className="row">
            <Icon name="doc" />
            <NameInput
              initial={a.title}
              label={t('artifacts.rename')}
              max={MAX_TITLE}
              onDone={(title) => {
                close();
                if (title !== undefined && title !== a.title) void ctx.track(a.slug, ctx.act({ kind: 'artifact.rename', slug: a.slug, title }));
              }}
            />
          </span>
        ) : (
          <button type="button" className="row row-btn" onClick={() => ctx.bridge.post({ type: 'openArtifact', slug: a.slug })} aria-label={`${name} — ${t('artifacts.open')}`}>
            <Icon name="doc" />
            <span className="ttl">{name}</span>
            {a.updatedAt !== undefined && <span className="tm">{formatAge(now - a.updatedAt, t)}</span>}
          </button>
        )}
        {/* While renaming, the field takes the whole row: no tools over its end. */}
        {panel !== 'rename' && <span className="tools">
          <button
            type="button"
            className="tbtn"
            aria-pressed={a.pinned}
            aria-label={a.pinned ? t('artifacts.unpin') : t('artifacts.pin')}
            onClick={() => void ctx.track(a.slug, ctx.act({ kind: 'artifact.pin', slug: a.slug, pinned: !a.pinned }))}
          >
            <Icon name="pin" />
          </button>
          <button type="button" className="tbtn" aria-label={t('artifacts.menu', { name })} aria-expanded={panel !== undefined} onClick={() => setPanel((p) => (p === undefined ? 'menu' : undefined))}>
            <Icon name="more" />
          </button>
        </span>}
        {panel !== undefined && panel !== 'rename' && (
          // Floats under the row's tools, over the list: nothing below moves (14/11).
          <Popover label={t('artifacts.menu', { name })} onClose={close}>
            <>
          {panel === 'menu' && (
            <div className="fmenu" role="group" aria-label={t('artifacts.menu', { name })}>
              <button type="button" className="fm-btn" onClick={() => setPanel('rename')}>
                <Icon name="edit" /> {t('artifacts.rename')}
              </button>
              <button type="button" className="fm-btn" onClick={() => setPanel('project')}>
                <Icon name="columns" /> {t('artifacts.toProject')}
              </button>
              {snapshot.folders.length > 0 && (
                <button type="button" className="fm-btn" onClick={() => setPanel('folder')}>
                  <Icon name="list" /> {t('artifacts.toFolder')}
                </button>
              )}
              <button
                type="button"
                className="fm-btn"
                onClick={() => {
                  close();
                  void ctx.track(a.slug, ctx.act({ kind: 'artifact.copyLink', slug: a.slug }));
                }}
              >
                <Icon name="copy" /> {t('artifacts.copyLink')}
              </button>
              <button type="button" className="fm-btn danger" onClick={() => setPanel('delete')}>
                <Icon name="trash" /> {t('artifacts.delete')}
              </button>
            </div>
          )}
          {panel === 'project' && (
            <div className="fmenu">
              <label className="field">
                <span>{t('artifacts.projectLabel')}</span>
                <NameInput
                  initial={a.project ?? ''}
                  label={t('artifacts.projectLabel')}
                  max={MAX_NAME}
                  list="artifact-projects"
                  allowEmpty
                  onDone={(project) => {
                    close();
                    // undefined: Escape. '': emptied on purpose — « Other ».
                    if (project === undefined || project === (a.project ?? '')) return;
                    void ctx.track(a.slug, ctx.act({ kind: 'artifact.project', slugs: [a.slug], project: project === '' ? null : project }));
                  }}
                />
              </label>
              <p className="hint">{t('artifacts.projectHint')}</p>
            </div>
          )}
          {panel === 'folder' && (
            <div className="fmenu" role="group" aria-label={t('artifacts.toFolder')}>
              {snapshot.folders.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  className="fm-btn"
                  onClick={() => {
                    close();
                    void ctx.track(a.slug, ctx.act({ kind: 'artifact.folder', slug: a.slug, title: a.title, folder: f.id }));
                  }}
                >
                  <Icon name="list" /> {f.name}
                </button>
              ))}
              <button
                type="button"
                className="fm-btn"
                onClick={() => {
                  close();
                  void ctx.track(a.slug, ctx.act({ kind: 'artifact.folder', slug: a.slug, title: a.title }));
                }}
              >
                <Icon name="close" /> {t('artifacts.noFolder')}
              </button>
            </div>
          )}
          {panel === 'delete' && (
            <Confirm
              danger
              yes={t('artifacts.delete')}
              no={t('action.cancel')}
              onYes={() => {
                close();
                void ctx.track(a.slug, ctx.act({ kind: 'artifact.delete', slug: a.slug })).then((r) => {
                  if (r.ok) ctx.notify(t('artifacts.deleted', { name }));
                });
              }}
              onNo={close}
            >
              {t('artifacts.deleteConfirm', { name })}
            </Confirm>
          )}
            </>
          </Popover>
        )}
      </div>
    </div>
  );
}
