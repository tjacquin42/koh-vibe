import { foldedText, isEpochMs, isRecord, isoTimeOf, nonEmptyString } from '../lib/json';

/**
 * A page published on claude.ai, as the view needs it. Only the person's own:
 * the shared ones were not asked for.
 */
export interface Artifact {
  slug: string;
  /** Whitespace folded; empty when it has none — the view then says « Untitled ». */
  title: string;
  /** Last update — epoch ms. */
  updatedAt?: number;
  pinned: boolean;
}

export interface ArtifactList {
  artifacts: Artifact[];
  truncated: boolean;
}

/** One page of the listing — what Claude Code itself asks for. */
export const ARTIFACTS_PAGE = 200;

export function parseArtifacts(raw: unknown): ArtifactList | undefined {
  if (!isRecord(raw)) return undefined;
  const frames = raw['frames'];
  let rows: unknown[] = [];
  // A missing list is an empty one — Claude Code reads it so too.
  if (Array.isArray(frames)) rows = frames;
  else if (frames !== undefined) return undefined;
  // Without this flag the server says nothing about pins, whatever each row carries.
  const pins = raw['starsEnabled'] === true;
  const artifacts: Artifact[] = [];
  for (const row of rows) {
    const artifact = artifactOf(row, pins);
    if (artifact !== undefined) artifacts.push(artifact);
  }
  // The server does not say when it held rows back; a full page is the only sign.
  return { artifacts, truncated: rows.length >= ARTIFACTS_PAGE };
}

/**
 * The listing's envelope as observed: an object carrying a `frames` array. A
 * 200 without one still reads as an empty list — Claude Code reads it so — but
 * the log names it: it is what a changed endpoint would look like.
 */
export function isFramesListing(raw: unknown): boolean {
  return isRecord(raw) && Array.isArray(raw['frames']);
}

function artifactOf(row: unknown, pins: boolean): Artifact | undefined {
  if (!isRecord(row)) return undefined;
  const slug = nonEmptyString(row['slug']);
  // Only one's own, and only the live ones: a deleted page is gone for everyone already.
  if (slug === undefined || row['rel'] !== 'mine' || row['softDeleted'] === true) return undefined;
  return {
    slug,
    title: foldedText(row['title']),
    updatedAt: isoTimeOf(row['updatedAt']),
    pinned: pins && row['starred'] === true,
  };
}

/** Pinned first, as in claude.ai's sidebar; then the most recently updated; an undated row last. */
export function sortArtifacts(list: readonly Artifact[]): Artifact[] {
  return [...list].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    const ta = a.updatedAt ?? Number.NEGATIVE_INFINITY;
    const tb = b.updatedAt ?? Number.NEGATIVE_INFINITY;
    if (ta !== tb) return tb - ta;
    return a.title.localeCompare(b.title);
  });
}

/** Whether a value read back from the cache is an artifact — same caution as `isRoutine`. */
export function isArtifact(v: unknown): v is Artifact {
  if (!isRecord(v)) return false;
  const updatedAt = v['updatedAt'];
  return (
    typeof v['slug'] === 'string' &&
    typeof v['title'] === 'string' &&
    typeof v['pinned'] === 'boolean' &&
    // A time no Date can hold would throw while the row is drawn.
    (updatedAt === undefined || isEpochMs(updatedAt))
  );
}

/** The page on claude.ai — the exact form Claude Code's own listing gives for a slug. */
export function artifactUrl(slug: string): string {
  return `https://claude.ai/artifact/${encodeURIComponent(slug)}`;
}
