import { rename, stat } from 'node:fs/promises';

/**
 * Picks up the state left behind by the extension's former name.
 *
 * A folder rename, not a copy: the state is a whole — sessions, filing,
 * chosen order, backups — and a partial copy interrupted midway would leave
 * two locations contradicting each other, with neither one authoritative.
 *
 * Three conditions, and all three are needed:
 * 1. the new root does not exist yet — if it does, it is authoritative and
 *    the old one is just a leftover; overwriting it would erase recent work;
 * 2. the old one exists;
 * 3. the rename succeeds — otherwise we carry on with no state, which is
 *    the behaviour of a fresh install, never an error shown to the user.
 *
 * Returns what happened, so the caller can report it once.
 */
export async function migrateLegacyHome(legacy: string, home: string): Promise<'migrated' | 'nothing'> {
  if (legacy === home) return 'nothing';
  try {
    await stat(home);
    return 'nothing';
  } catch {
    // The new root does not exist: this is the only case where picking up
    // the old one makes sense.
  }
  try {
    await stat(legacy);
  } catch {
    return 'nothing';
  }
  try {
    await rename(legacy, home);
    return 'migrated';
  } catch {
    // Different volumes, permissions, a race with another window: we start
    // over with an empty state rather than block activation.
    return 'nothing';
  }
}
