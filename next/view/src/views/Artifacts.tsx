import type { ArtifactView } from '../../../src/shared/protocol';
import { artifactSections } from '../sections';
import { formatAge } from '../format';
import { Icon } from '../ui/icons';
import { Section } from '../ui/Section';
import type { ViewCtx } from './context';

export function ArtifactsTab({ ctx }: { ctx: ViewCtx }) {
  const { t, snapshot } = ctx;
  const items = snapshot.artifacts?.items ?? [];
  if (items.length === 0) return <p className="hint pad">{t('artifacts.none')}</p>;
  const s = artifactSections(items);
  return (
    <>
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
    </>
  );
}

export function ArtifactRow({ ctx, a }: { ctx: ViewCtx; a: ArtifactView }) {
  const { t, now } = ctx;
  return (
    <button type="button" className="row row-btn" onClick={() => ctx.bridge.post({ type: 'openArtifact', slug: a.slug })} aria-label={`${a.title || t('artifacts.untitled')} — ${t('artifacts.open')}`}>
      <Icon name="doc" />
      <span className="ttl">{a.title || t('artifacts.untitled')}</span>
      {a.updatedAt !== undefined && <span className="tm">{formatAge(now - a.updatedAt, t)}</span>}
      <span className="go">
        <Icon name="external" size={12} />
      </span>
    </button>
  );
}
