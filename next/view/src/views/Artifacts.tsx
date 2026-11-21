import { useEffect, useMemo, useRef, useState } from 'react';
import type { ViewCtx } from '../context';
import { useDragScroll } from '../hooks/useDragScroll';
import { artifactSections, projectOrder } from '../sections';
import { Icon } from '../components/atoms/Icon';
import { Section } from '../components/molecules/Section';
import type { ArtifactDnd, ArtifactDrag } from '../components/organisms/artifact-dnd';
import { ArtifactRow } from '../components/organisms/ArtifactRow';
import { CloudBar } from '../components/organisms/CloudBar';
import { NewProject } from '../components/organisms/NewProject';
import { ProjectSection } from '../components/organisms/ProjectSection';

/** How long what just landed is marked: the time for the list to come back with it, and for its motion to play. */
const LANDED_MS = 1_500;

export function ArtifactsTab({ ctx }: { ctx: ViewCtx }) {
  const { t, snapshot } = ctx;
  const items = snapshot.artifacts?.items ?? [];
  // Artifacts move between projects by being dragged there (16/11) — onto a
  // project, onto « Other » to leave theirs, or onto « New project ».
  const [drag, setDrag] = useState<ArtifactDrag | undefined>();
  const [landed, setLanded] = useState<ArtifactDrag | undefined>();
  // The projects as they are dragged (21/11), by their heading: shown at once, before the host writes it back.
  const [moving, setMoving] = useState<string | undefined>();
  const saved = snapshot.artifacts?.order;
  // Kept until the host's order changes: to this one once written, or to another window's.
  const savedKey = (saved ?? []).join('\n');
  const [placed, setPlaced] = useState<{ order: string[]; over: string } | undefined>();
  const order = placed !== undefined && placed.over === savedKey ? placed.order : (saved ?? []);
  const landedTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(landedTimer.current), []);
  // Dragging near the list's top or bottom edge scrolls it: the projects are many (hooks/useDragScroll.ts).
  const root = useRef<HTMLDivElement>(null);
  useDragScroll(root, drag !== undefined || moving !== undefined);
  // The folders made by hand show though they hold nothing — and though the list is empty.
  const made = snapshot.artifacts?.folders ?? [];
  const s = artifactSections(items, made, order);
  const named = s.projects.flatMap((p) => (p.project === undefined ? [] : [p.project]));
  const dnd = useMemo<ArtifactDnd>(
    () => ({
      drag,
      setDrag,
      landed,
      file: (d, project) => {
        setDrag(undefined);
        // Little motion in this tab, on purpose: only where it landed shows, a moment — and nothing with animations off.
        if (ctx.animate) {
          setLanded({ slug: d.slug, project: project ?? undefined });
          window.clearTimeout(landedTimer.current);
          landedTimer.current = window.setTimeout(() => setLanded(undefined), LANDED_MS);
        }
        void ctx.track(d.slug, ctx.act({ kind: 'artifact.project', slugs: [d.slug], project }));
      },
      moving,
      setMoving,
      place: (name, target, after) => {
        setMoving(undefined);
        const next = projectOrder(named, name, target, after);
        if (next.join('\n') === named.join('\n')) return;
        setPlaced({ order: next, over: savedKey });
        void ctx.act({ kind: 'artifact.orderProjects', order: next });
      },
    }),
    [drag, landed, moving, named.join('\n'), savedKey, ctx],
  );
  const bar = <CloudBar ctx={ctx} what="artifacts" at={snapshot.artifacts?.at} />;
  if (items.length === 0) {
    return (
      <div ref={root}>
        {bar}
        <p className="hint pad">{t('artifacts.none')}</p>
        <NewProject ctx={ctx} dnd={dnd} />
        {s.projects.map((p) => (
          <ProjectSection key={`proj:${p.project ?? ''}`} ctx={ctx} project={p.project} items={p.items} dnd={dnd} made />
        ))}
      </div>
    );
  }
  return (
    <div ref={root}>
      {bar}
      {/* Pinned and Recent stay on top, open by default; they fold away when they take too much room (14/11). */}
      {s.pinned.length > 0 && (
        <Section title={t('artifacts.pinned')} count={s.pinned.length} marker={<Icon name="pin" size={13} />} folded={ctx.isFolded('art:pinned')} onToggle={() => ctx.toggle('art:pinned')}>
          {s.pinned.map((a) => (
            <ArtifactRow key={a.slug} ctx={ctx} a={a} dnd={dnd} />
          ))}
        </Section>
      )}
      <Section title={t('artifacts.recent')} count={s.recent.length} folded={ctx.isFolded('art:recent')} onToggle={() => ctx.toggle('art:recent')}>
        {s.recent.map((a) => (
          <ArtifactRow key={a.slug} ctx={ctx} a={a} dnd={dnd} />
        ))}
      </Section>
      <h2 className="sec sec-label">{t('artifacts.byProject')}</h2>
      {/* Right under the heading (16/11), where it is seen without scrolling past every project. */}
      <NewProject ctx={ctx} dnd={dnd} />
      {s.projects.map((p) => (
        <ProjectSection key={`proj:${p.project ?? ''}`} ctx={ctx} project={p.project} items={p.items} dnd={dnd} made={p.project !== undefined && made.includes(p.project)} />
      ))}
      {/* « Other » only shows while it holds something: carried, an artifact still needs it to leave its project. */}
      {drag !== undefined && drag.project !== undefined && !s.projects.some((p) => p.project === undefined) && <ProjectSection ctx={ctx} project={undefined} items={[]} dnd={dnd} />}
    </div>
  );
}
