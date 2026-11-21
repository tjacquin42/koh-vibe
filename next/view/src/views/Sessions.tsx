import { useEffect, useMemo, useRef, useState } from 'react';
import type { FolderView } from '../../../src/shared/protocol';
import type { ViewCtx } from '../context';
import { UNFILED } from '../format';
import { useDragScroll } from '../hooks/useDragScroll';
import { useFlip } from '../hooks/useFlip';
import { revealRow } from '../lib/reveal';
import { revealStep } from '../sections';
import { Icon } from '../components/atoms/Icon';
import { Section } from '../components/molecules/Section';
import { ClosedRow } from '../components/organisms/ClosedRow';
import type { Dnd, Drag } from '../components/organisms/folder-dnd';
import { FolderSection } from '../components/organisms/FolderSection';
import { HooksMissing } from '../components/organisms/HooksMissing';
import { Inbox } from '../components/organisms/Inbox';
import { NewFolder } from '../components/organisms/NewFolder';

/** The fold key of the Archives — its own (16/11), so no fold kept from before they could fold again applies. */
const ARCHIVES = 'archives';

export function SessionsTab({ ctx }: { ctx: ViewCtx }) {
  const { t, snapshot } = ctx;
  const byId = useMemo(() => new Map(snapshot.sessions.map((s) => [s.id, s])), [snapshot.sessions]);
  const closed = snapshot.closed.filter((c) => !byId.has(c.sessionId));
  const [drag, setDrag] = useState<Drag | undefined>();
  // An artifact dropped on another folder shows where it landed, a moment (16/11).
  const [landed, setLanded] = useState<string | undefined>();
  const landedTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(landedTimer.current), []);
  const land = (slug: string): void => {
    if (!ctx.animate) return;
    setLanded(slug);
    window.clearTimeout(landedTimer.current);
    landedTimer.current = window.setTimeout(() => setLanded(undefined), 1_500);
  };
  // Rows slide to where they now belong (hooks/useFlip.ts) — under the Animations setting.
  const root = useRef<HTMLDivElement>(null);
  useFlip(root, ctx.animate);
  // Dragging near the list's top or bottom edge scrolls it (hooks/useDragScroll.ts).
  useDragScroll(root, drag !== undefined);
  // Another conversation in front — one just opened above all: its folder
  // opens and the list brings its row into sight, as V1 revealed it.
  const active = ctx.activeId;
  const shown = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (active === undefined) return;
    const folder = ctx.where.get(active);
    const step = revealStep(shown.current, active, folder, snapshot.folders.some((f) => ctx.isBusy(`new:${f.id}`)));
    if (step === undefined) return;
    shown.current = step.key;
    if (!step.reveal) return;
    if (folder !== undefined && folder !== UNFILED && ctx.isFolded(folder)) ctx.toggle(folder);
    window.requestAnimationFrame(() => {
      const list = root.current;
      const row = list?.querySelector(`[data-session="${CSS.escape(active)}"]`);
      // Not drawn yet: the next snapshot tries again.
      if (list === null || list === undefined || row === null || row === undefined) shown.current = undefined;
      // Once its folder has opened and the row has slid in: measured mid-flight, it came to rest half hidden (21/11).
      else void revealRow(list, row, ctx.animate);
    });
  }, [active, ctx, snapshot.folders]);
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
  const dnd: Dnd = { drag, setDrag, landed, land };
  const archivesFolded = ctx.isFolded(ARCHIVES);
  return (
    <div ref={root} className="flip-root">
      {snapshot.hooksInstalled === false && <HooksMissing ctx={ctx} />}
      <Inbox ctx={ctx} />
      {snapshot.folders.map((f) => (
        <FolderSection key={f.id} ctx={ctx} f={f} byId={byId} dnd={dnd} />
      ))}
      <NewFolder ctx={ctx} />
      {/* The archives, then the conversations in no folder, at the very bottom (14/11). */}
      {/* No count (15/11): the last conversations closed, as many as the settings say. Folded at will (16/11), open to begin with. */}
      <Section
        title={t('closed.title')}
        marker={<Icon name="archive" size={13} />}
        folded={archivesFolded}
        onToggle={() => ctx.toggle(ARCHIVES)}
        // It holds every closed one, folded or not: a conversation leaving for it
        // goes down into it, not up into the folder it left (15/11).
        headProps={{ 'data-flip-anchor': 'closed', 'data-flip-folded': String(archivesFolded), 'data-flip-holds': closed.map((c) => c.sessionId).join(' ') }}
      >
        {closed.length === 0 ? <p className="hint">{t('closed.none')}</p> : closed.slice(0, ctx.archives).map((c) => <ClosedRow key={c.sessionId} ctx={ctx} c={c} />)}
      </Section>
      {(unfiled.sessionIds.length > 0 || drag?.kind === 'session') && <FolderSection ctx={ctx} f={unfiled} byId={byId} dnd={dnd} />}
    </div>
  );
}
