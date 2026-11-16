/** Class names joined, the absent ones left out: `cx('row', busy && 'busy')`. */
export function cx(...parts: readonly (string | false | undefined)[]): string {
  return parts.filter((p): p is string => typeof p === 'string' && p.length > 0).join(' ');
}
