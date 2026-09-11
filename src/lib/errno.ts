/**
 * Whether a caught value is a Node error carrying a `code` — the shape every
 * filesystem failure has, and the one the callers switch on (`ENOENT`,
 * `EEXIST`, `EPERM`). One definition rather than the three inline copies it
 * replaces, for the reason `isRecord` was factored out (lib/json.ts).
 */
export function isErrnoException(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && 'code' in err;
}
