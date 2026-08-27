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
