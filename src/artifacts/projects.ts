import { isRecord } from '../lib/json';
import { isSlug, sortArtifacts, type Artifact } from './model';

/**
 * Where the artifacts are filed, by project.
 *
 * On this machine only: claude.ai has no folders for artifacts — nothing in the
 * endpoints Claude Code calls carries one — so the filing lives beside the
 * cache, shared between windows like the session folders.
 *
 * `filed` maps a slug to its project's name, or to `null` for « Other » when
 * that was chosen. A slug absent from it was never filed: the artifact goes
 * where its title points (`projectOfArtifact`), and the next session that
 * publishes it may still file it (`fileIfUnfiled`). `null` is what keeps a
 * choice of « Other » from being undone by either.
 *
 * `aliases` maps the old name of a renamed project, folded (`projectKey`),
 * to its new name — or to `null` when it was emptied into « Other ». What
 * still goes by the old name finds the project it became: the repository a
 * project was named after (`projectForName`), a title (`projectOfArtifact`).
 */
export interface ArtifactProjects {
  filed: Readonly<Record<string, string | null>>;
  aliases: Readonly<Record<string, string | null>>;
  /** Fields of the file we do not know: preserved as is on write. */
  unknown: Readonly<Record<string, unknown>>;
}

/** The artifacts of one project, or of « Other » (`project === undefined`). */
export interface ProjectGroup {
  project: string | undefined;
  artifacts: Artifact[];
}

const KNOWN = new Set(['version', 'filed', 'aliases']);

export function emptyArtifactProjects(): ArtifactProjects {
  return { filed: {}, aliases: {}, unknown: {} };
}

/** A project's name, or `null` for « Other »: the value of both maps. Anything else reads as absent. */
function targetOf(v: unknown): string | null | undefined {
  if (v === null) return null;
  const name = typeof v === 'string' ? v.trim() : '';
  return name.length > 0 ? name : undefined;
}

/** Unreadable data means « nothing filed »: the view must render no matter what. */
export function parseArtifactProjects(raw: string): ArtifactProjects {
  let root: unknown;
  try {
    root = JSON.parse(raw);
  } catch {
    return emptyArtifactProjects();
  }
  if (!isRecord(root)) return emptyArtifactProjects();
  const filed: Record<string, string | null> = {};
  const rawFiled = root['filed'];
  if (isRecord(rawFiled)) {
    for (const [slug, project] of Object.entries(rawFiled)) {
      const target = targetOf(project);
      if (isSlug(slug) && target !== undefined) filed[slug] = target;
    }
  }
  // Keyed by a folded name, and only by one: a key the folding would change
  // was not written here — and none can be `__proto__`, which folds to « proto ».
  const aliases: Record<string, string | null> = {};
  const rawAliases = root['aliases'];
  if (isRecord(rawAliases)) {
    for (const [key, project] of Object.entries(rawAliases)) {
      const target = targetOf(project);
      if (key.length > 0 && projectKey(key) === key && target !== undefined) aliases[key] = target;
    }
  }
  const unknown = Object.fromEntries(Object.entries(root).filter(([key]) => !KNOWN.has(key)));
  return { filed, aliases, unknown };
}

export function serializeArtifactProjects(s: ArtifactProjects): string {
  return `${JSON.stringify({ ...s.unknown, version: 1, filed: s.filed, aliases: s.aliases }, null, 2)}\n`;
}

/**
 * A project's name as two spellings of it compare: accents, case and
 * separators left out — « Koh-Vibe », « koh-vibe » and « koh vibe » are one
 * project. The same folding lets a title name a project (`titleProject`).
 */
export function projectKey(name: string): string {
  return name
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** Every project something is filed into, once each, « Other » aside. */
export function knownProjects(s: ArtifactProjects): string[] {
  const out: string[] = [];
  for (const project of Object.values(s.filed)) {
    if (project !== null && !out.includes(project)) out.push(project);
  }
  return out;
}

/**
 * The spelling a name is filed under: the one already in use when the name
 * differs from it only in spelling — so that filing into « nti » does not
 * open a second folder next to « NTI ».
 */
function canonical(name: string, among: readonly string[]): string {
  const trimmed = name.trim();
  const key = projectKey(trimmed);
  if (key.length === 0) return trimmed;
  return among.find((p) => projectKey(p) === key) ?? trimmed;
}

/** Files the artifacts into a project — `null`, or a blank name, files them into « Other ». */
export function fileArtifacts(s: ArtifactProjects, slugs: readonly string[], project: string | null): ArtifactProjects {
  const target = project === null || project.trim().length === 0 ? null : canonical(project, knownProjects(s));
  const filed = { ...s.filed };
  for (const slug of slugs) {
    if (isSlug(slug)) filed[slug] = target;
  }
  return { ...s, filed };
}

/**
 * Files an artifact into a project unless it was ever filed — « Other »
 * included. What a publish does on its own: it never undoes a choice.
 */
export function fileIfUnfiled(s: ArtifactProjects, slug: string, project: string): ArtifactProjects {
  if (Object.hasOwn(s.filed, slug) || project.trim().length === 0) return s;
  return fileArtifacts(s, [slug], project);
}

/**
 * Renames a project for every artifact in it. A name another project already
 * goes by merges the two; `null` empties the project into « Other ».
 *
 * The old name is kept as an alias of the new one — unless only its spelling
 * changed — and the old names it already had follow it: a project renamed
 * twice still answers to the name of the repository it was born from.
 */
export function renameProject(s: ArtifactProjects, from: string, to: string | null): ArtifactProjects {
  // Compared with the OTHER projects only: renaming « nti » to « NTI » must
  // change the spelling, not be read as « already called that ».
  const others = knownProjects(s).filter((p) => p !== from);
  const target = to === null || to.trim().length === 0 ? null : canonical(to, others);
  const filed: Record<string, string | null> = {};
  for (const [slug, project] of Object.entries(s.filed)) filed[slug] = project === from ? target : project;
  const aliases: Record<string, string | null> = {};
  for (const [key, project] of Object.entries(s.aliases)) aliases[key] = project === from ? target : project;
  const fromKey = projectKey(from);
  if (fromKey.length > 0) aliases[fromKey] = target;
  // A name that is its project's own again needs no alias.
  for (const [key, project] of Object.entries(aliases)) {
    if (project !== null && projectKey(project) === key) delete aliases[key];
  }
  return { ...s, filed, aliases };
}

/**
 * The project a name stands for — the repository a publish came from: the
 * project going by that name, else the one it was renamed to, else a project
 * of that very name. `null` when it was emptied into « Other »: its name then
 * files nothing any more.
 */
export function projectForName(s: ArtifactProjects, name: string): string | null {
  const key = projectKey(name);
  // A project going by the name wins over an old name: one created later
  // under a name it once had takes that name back.
  const own = knownProjects(s).find((p) => projectKey(p) === key);
  if (own !== undefined) return own;
  if (Object.hasOwn(s.aliases, key)) return s.aliases[key] ?? null;
  return name.trim();
}

/**
 * Renames a folder as it is shown: `shown` are the slugs it holds right now,
 * the ones there by their title included. They are filed into it first, so
 * that a new name their title does not hold leaves none of them behind.
 */
export function renameFolder(
  s: ArtifactProjects,
  from: string,
  shown: readonly string[],
  to: string | null,
): ArtifactProjects {
  return renameProject(fileArtifacts(s, shown, from), from, to);
}

/**
 * The project a title names, as a whole word: « Journal de bord NTI » is
 * NTI's, « Les NTIs » is nobody's. When several match, the longest name —
 * the most specific — wins.
 */
export function titleProject(title: string, projects: readonly string[]): string | undefined {
  const words = ` ${projectKey(title)} `;
  let best: string | undefined;
  let bestKey = '';
  for (const project of projects) {
    const key = projectKey(project);
    if (key.length === 0 || !words.includes(` ${key} `)) continue;
    const longer = key.length > bestKey.length;
    const tieFirst = key.length === bestKey.length && best !== undefined && project.localeCompare(best) < 0;
    if (longer || tieFirst) {
      best = project;
      bestKey = key;
    }
  }
  return best;
}

/**
 * Every name a title can point to a project by, and the project it points
 * to: each project's own, and the old names of the renamed ones that still
 * exist — an old name another project has taken back is that project's.
 */
function titleNames(s: ArtifactProjects): Map<string, string> {
  const projects = knownProjects(s);
  const names = new Map(projects.map((p) => [p, p] as const));
  const taken = new Set(projects.map(projectKey));
  for (const [key, project] of Object.entries(s.aliases)) {
    if (project !== null && projects.includes(project) && !taken.has(key)) names.set(key, project);
  }
  return names;
}

/**
 * The project an artifact shows under: where it was filed; else, never filed,
 * the project its title names — by its name or an old one; else none —
 * « Other ». A title only points to a project that already exists: it never
 * opens one.
 */
export function projectOfArtifact(
  a: Artifact,
  s: ArtifactProjects,
  names: ReadonlyMap<string, string> = titleNames(s),
): string | undefined {
  if (Object.hasOwn(s.filed, a.slug)) return s.filed[a.slug] ?? undefined;
  const name = titleProject(a.title, [...names.keys()]);
  return name === undefined ? undefined : names.get(name);
}

/**
 * The view's folders: the projects by name, « Other » last, each sorted as
 * the flat list was — pinned first, then the most recent. A project with
 * nothing left in it is not shown.
 */
export function groupByProject(list: readonly Artifact[], s: ArtifactProjects): ProjectGroup[] {
  const names = titleNames(s);
  const named = new Map<string, Artifact[]>();
  const other: Artifact[] = [];
  for (const a of list) {
    const project = projectOfArtifact(a, s, names);
    if (project === undefined) other.push(a);
    else named.set(project, [...(named.get(project) ?? []), a]);
  }
  const groups: ProjectGroup[] = [...named.entries()]
    .sort(([a], [b]) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true }) || a.localeCompare(b))
    .map(([project, artifacts]) => ({ project, artifacts: sortArtifacts(artifacts) }));
  if (other.length > 0) groups.push({ project: undefined, artifacts: sortArtifacts(other) });
  return groups;
}
