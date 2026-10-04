/**
 * Colour the LABEL of a row, not just its icon.
 *
 * VSCode offers no colour property on a `TreeItem`. The only lever is the
 * `FileDecorationProvider`: the row is given a `resourceUri`, and the
 * provider answers with a colour for that URI.
 *
 * The colour travels IN the URI rather than in state kept on the side. A
 * provider that kept its own table would have to be resynchronised on every
 * colour change, and a table lagging one step behind is exactly the flaw
 * that has already been paid for three times here. A URI changes when the
 * colour changes; VSCode then asks for the decoration again on its own.
 */
export const KOH_SCHEME = 'koh-vibe';

/** What sets our URIs apart from any other: a scheme of our own, never `file`. */
export function decorationUriParts(
  kind: 'group' | 'session',
  id: string,
  theme: string,
): { scheme: string; authority: string; path: string; query: string } {
  return { scheme: KOH_SCHEME, authority: kind, path: `/${id}`, query: `c=${theme}` };
}

/**
 * The colour carried by a URI, or `undefined` if it is not one of ours.
 *
 * Only returns a colour for our scheme: called for EVERY resource VSCode
 * displays, this provider must never tint a user's file on the grounds that
 * its query looks like ours.
 */
export function decorationColorOf(uri: { scheme: string; query: string }): string | undefined {
  if (uri.scheme !== KOH_SCHEME) return undefined;
  const value = new URLSearchParams(uri.query).get('c');
  return value !== null && value.length > 0 ? value : undefined;
}
