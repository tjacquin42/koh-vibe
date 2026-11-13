import { commitMerged, readRaw, withFileQueue } from '../lib/shared-file';
import { emptyArtifactProjects, parseArtifactProjects, serializeArtifactProjects, type ArtifactProjects } from './projects';

/** An unreadable or missing listing counts as « nothing filed »: the view has to display no matter what. */
export async function readArtifactProjects(file: string): Promise<ArtifactProjects> {
  return toState(await readRaw(file));
}

/**
 * Applies `fn` to the filing and writes it, through the machinery every shared
 * state file uses (lib/shared-file.ts).
 *
 * The change is applied again to the freshest content on every round — the
 * closed history's rule, not the folders' three-way merge. Every change here
 * is a function of the state (« file these », « rename that », « file this
 * unless it was »), and that last one is why: merged from a stale copy, a
 * publish filing on its own would overwrite a choice another window had just
 * made.
 */
export function updateArtifactProjects(
  file: string,
  fn: (s: ArtifactProjects) => ArtifactProjects,
): Promise<ArtifactProjects> {
  return withFileQueue(file, () =>
    commitMerged(file, 'artifact-projects', (latestRaw) => fn(toState(latestRaw)), serializeArtifactProjects),
  );
}

function toState(raw: string | undefined): ArtifactProjects {
  return raw === undefined ? emptyArtifactProjects() : parseArtifactProjects(raw);
}
