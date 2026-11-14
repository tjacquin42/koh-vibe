import { useState } from 'react';
import { MAX_NAME, MAX_TITLE } from '../../../src/shared/actions';
import type { ArtifactView } from '../../../src/shared/protocol';
import { artifactSections } from '../sections';
import { formatAge } from '../format';
import { Icon } from '../ui/icons';
import { Confirm, NameInput } from '../ui/Inline';
import { Section } from '../ui/Section';
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
  const { t, now } = ctx;
  const [busy, setBusy] = useState(false);
  return (
    <div className="cloudbar">
      <span>{at === undefined ? t('cloud.never') : t('cloud.age', { age: formatAge(now - at, t) })}</span>
      <button
        type="button"
        className="btn-ghost"
        disabled={busy}
        aria-busy={busy}
        onClick={() => {
          setBusy(true);
          void ctx.act({ kind: 'cloud.refresh', what }).finally(() => setBusy(false));
        }}
      >
        <Icon name="resume" /> {busy ? t('cloud.refreshing') : t('cloud.refresh')}
      </button>
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
    <div className={`arow${panel !== undefined ? ' open' : ''}${ctx.isBusy(a.slug) ? ' busy' : ''}`} aria-busy={ctx.isBusy(a.slug)}>
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
          <button type="button" className="tbtn" aria-label={t('artifacts.menu', { name })} aria-expanded={panel === 'menu'} onClick={() => setPanel((p) => (p === 'menu' ? undefined : 'menu'))}>
            <Icon name="more" />
          </button>
        </span>}
      </div>
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
    </div>
  );
}
