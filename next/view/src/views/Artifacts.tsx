import type { ViewCtx } from '../context';
import { artifactSections } from '../sections';
import { Icon } from '../components/atoms/Icon';
import { Section } from '../components/molecules/Section';
import { ArtifactRow, PROJECTS_LIST } from '../components/organisms/ArtifactRow';
import { CloudBar } from '../components/organisms/CloudBar';
import { ProjectSection } from '../components/organisms/ProjectSection';

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
      {/* Pinned and Recent stay on top, open by default; they fold away when they take too much room (14/11). */}
      {s.pinned.length > 0 && (
        <Section title={t('artifacts.pinned')} count={s.pinned.length} marker={<Icon name="pin" size={13} />} folded={ctx.isFolded('art:pinned')} onToggle={() => ctx.toggle('art:pinned')}>
          {s.pinned.map((a) => (
            <ArtifactRow key={a.slug} ctx={ctx} a={a} />
          ))}
        </Section>
      )}
      <Section title={t('artifacts.recent')} count={s.recent.length} folded={ctx.isFolded('art:recent')} onToggle={() => ctx.toggle('art:recent')}>
        {s.recent.map((a) => (
          <ArtifactRow key={a.slug} ctx={ctx} a={a} />
        ))}
      </Section>
      <h2 className="sec sec-label">{t('artifacts.byProject')}</h2>
      {s.projects.map((p) => (
        <ProjectSection key={`proj:${p.project ?? ''}`} ctx={ctx} project={p.project} items={p.items} />
      ))}
      <datalist id={PROJECTS_LIST}>
        {s.projects.flatMap((p) => (p.project === undefined ? [] : [<option key={p.project} value={p.project} />]))}
      </datalist>
    </>
  );
}
