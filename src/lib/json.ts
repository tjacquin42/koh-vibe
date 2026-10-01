/**
 * The predicate every reading boundary shares: JSON coming from a file or an
 * API is only usable as an object — never an array, never `null`.
 *
 * It was copied verbatim into eight modules; a copy that drifted would make
 * one boundary accept what the others refuse. Factored here for the same
 * reason as `ReentrantGuard`: one definition, testable once, no `vscode`
 * dependency.
 */
export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** A string with something in it, or nothing: an empty field reads as absent at every boundary. */
export function nonEmptyString(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

/**
 * A date as the APIs send it — ISO 8601, nanoseconds included — in epoch
 * milliseconds, or nothing for anything that does not read as one.
 */
export function isoTimeOf(v: unknown): number | undefined {
  if (typeof v !== 'string' || v.length === 0) return undefined;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : undefined;
}

/**
 * A label as a tree row can show it: whitespace — newlines included — folded
 * to single spaces, the ends trimmed. Anything but a string reads as empty.
 */
export function foldedText(v: unknown): string {
  return typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '';
}
