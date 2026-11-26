/**
 * The right-click menus (21/11): Koh-Vibe's own, drawn by the view in its
 * style and its language — no longer the editor's native menu. A row says
 * what it is in `data-kv-menu` (view/src/lib/menu-context.ts): its section,
 * the ids the actions need, and a few flags. The view lists the items of that
 * section whose flags hold; a click is posted to the host (protocol.ts
 * `menu`), which runs it (host/menus.ts `runMenu`) — what needs a word or a
 * yes there asks with the editor's own boxes.
 */

/** A row's kind, carried as `webviewSection`, the name it had under the native menus. */
export const SECTIONS = ['kvnSession', 'kvnClosed', 'kvnFolder', 'kvnUnfiled', 'kvnArtifact', 'kvnArtProject', 'kvnRoutine', 'kvnProcess'] as const;
export type Section = (typeof SECTIONS)[number];

/** The icons a menu line may carry: all in the view's set (atoms/Icon.tsx) — the compiler checks it there. */
export type MenuIcon = 'chat' | 'sheet' | 'moon' | 'close' | 'unread' | 'copy' | 'resume' | 'plus' | 'doc' | 'edit' | 'palette' | 'trash' | 'external' | 'pin' | 'play' | 'pause' | 'term';

export interface MenuItem {
  /** What the host runs (host/menus.ts `runMenu`). */
  id: string;
  section: Section;
  /** Flags of the row that must hold — `!flag`: must not. */
  when?: readonly string[];
  /** Items of different groups are separated by a line. */
  group: number;
  icon: MenuIcon;
  /** Red: it destroys something. */
  danger?: true;
  en: string;
  fr: string;
}

export const MENU_ITEMS: readonly MenuItem[] = [
  { id: 'session.open', section: 'kvnSession', group: 1, icon: 'chat', en: 'Go to the conversation', fr: 'Aller à la conversation' },
  { id: 'session.sheet', section: 'kvnSession', group: 1, icon: 'sheet', en: 'Open its sheet', fr: 'Ouvrir sa fiche' },
  { id: 'session.sleep', section: 'kvnSession', when: ['!kvnEnded', 'kvnFiled'], group: 2, icon: 'moon', en: 'Put to sleep', fr: 'Mettre en veille' },
  { id: 'session.close', section: 'kvnSession', group: 2, icon: 'close', en: 'Close', fr: 'Fermer' },
  { id: 'session.unread', section: 'kvnSession', when: ['kvnCanUnread'], group: 3, icon: 'unread', en: 'Mark as unread', fr: 'Afficher comme non lu' },
  { id: 'session.copyId', section: 'kvnSession', group: 9, icon: 'copy', en: 'Copy the ID', fr: 'Copier l’ID' },
  { id: 'closed.reopen', section: 'kvnClosed', when: ['kvnResumable'], group: 1, icon: 'resume', en: 'Resume', fr: 'Reprendre' },
  { id: 'closed.copyId', section: 'kvnClosed', group: 9, icon: 'copy', en: 'Copy the ID', fr: 'Copier l’ID' },
  { id: 'folder.newSession', section: 'kvnFolder', group: 1, icon: 'plus', en: 'New conversation here', fr: 'Nouvelle conversation ici' },
  { id: 'unfiled.newSession', section: 'kvnUnfiled', group: 1, icon: 'plus', en: 'New conversation', fr: 'Nouvelle conversation' },
  { id: 'folder.addRule', section: 'kvnFolder', group: 2, icon: 'chat', en: 'Add a rule', fr: 'Ajouter une règle' },
  { id: 'folder.openRules', section: 'kvnFolder', group: 2, icon: 'doc', en: 'See the rules', fr: 'Voir les règles' },
  { id: 'folder.rename', section: 'kvnFolder', group: 3, icon: 'edit', en: 'Rename…', fr: 'Renommer…' },
  { id: 'folder.color', section: 'kvnFolder', group: 3, icon: 'palette', en: 'Color…', fr: 'Couleur…' },
  { id: 'folder.delete', section: 'kvnFolder', group: 9, icon: 'trash', danger: true, en: 'Delete the folder…', fr: 'Supprimer le dossier…' },
  { id: 'artifact.open', section: 'kvnArtifact', group: 1, icon: 'external', en: 'Open on claude.ai', fr: 'Ouvrir sur claude.ai' },
  { id: 'artifact.pin', section: 'kvnArtifact', when: ['!kvnPinned'], group: 2, icon: 'pin', en: 'Pin', fr: 'Épingler' },
  { id: 'artifact.unpin', section: 'kvnArtifact', when: ['kvnPinned'], group: 2, icon: 'pin', en: 'Unpin', fr: 'Désépingler' },
  { id: 'artifact.rename', section: 'kvnArtifact', group: 2, icon: 'edit', en: 'Rename…', fr: 'Renommer…' },
  { id: 'artifact.copyLink', section: 'kvnArtifact', group: 8, icon: 'copy', en: 'Copy the link', fr: 'Copier le lien' },
  { id: 'artifact.delete', section: 'kvnArtifact', group: 9, icon: 'trash', danger: true, en: 'Delete…', fr: 'Supprimer…' },
  { id: 'artProject.rename', section: 'kvnArtProject', group: 1, icon: 'edit', en: 'Rename…', fr: 'Renommer…' },
  { id: 'routine.run', section: 'kvnRoutine', when: ['kvnCanRun'], group: 1, icon: 'play', en: 'Run now…', fr: 'Lancer maintenant…' },
  { id: 'routine.pause', section: 'kvnRoutine', when: ['kvnEnabled'], group: 1, icon: 'pause', en: 'Pause', fr: 'Mettre en pause' },
  { id: 'routine.resume', section: 'kvnRoutine', when: ['kvnCanResume'], group: 1, icon: 'play', en: 'Resume', fr: 'Reprendre' },
  { id: 'routine.open', section: 'kvnRoutine', group: 2, icon: 'external', en: 'Open on claude.ai', fr: 'Ouvrir sur claude.ai' },
  { id: 'routine.copyLink', section: 'kvnRoutine', group: 8, icon: 'copy', en: 'Copy the link', fr: 'Copier le lien' },
  { id: 'process.copyCommand', section: 'kvnProcess', group: 8, icon: 'term', en: 'Copy the command', fr: 'Copier la commande' },
  { id: 'process.copyPid', section: 'kvnProcess', group: 8, icon: 'copy', en: 'Copy the pid', fr: 'Copier le pid' },
  { id: 'process.kill', section: 'kvnProcess', group: 9, icon: 'close', danger: true, en: 'Terminate…', fr: 'Terminer…' },
];

const IDS: ReadonlySet<string> = new Set(MENU_ITEMS.map((m) => m.id));

export function isMenuId(v: unknown): v is string {
  return typeof v === 'string' && IDS.has(v);
}

function holds(flag: string, context: Readonly<Record<string, unknown>>): boolean {
  return flag.startsWith('!') ? context[flag.slice(1)] !== true : context[flag] === true;
}

/** What a right-click on a row offers, in groups, in the list's order. Empty: no menu at all. */
export function menuGroups(context: Readonly<Record<string, unknown>>): MenuItem[][] {
  const section = context['webviewSection'];
  const groups = new Map<number, MenuItem[]>();
  for (const m of MENU_ITEMS) {
    if (m.section !== section || !(m.when ?? []).every((f) => holds(f, context))) continue;
    const g = groups.get(m.group);
    if (g === undefined) groups.set(m.group, [m]);
    else g.push(m);
  }
  return [...groups.entries()].sort(([a], [b]) => a - b).map(([, items]) => items);
}
