import { copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { foreignFingerprint, upgradeHooks } from './installer';

/** The indentation the file was written with, kept as found: it is the user's file. */
function indentOf(raw: string): string | number {
  return /^\{\s*\n([ \t]+)"/.exec(raw)?.[1] ?? 2;
}

/**
 * Brings installed hooks up to the events this version listens to, at
 * start-up (21/11): a new event, such as `PostToolUseFailure`, must not wait
 * for the user to think of « Install hooks » again. Only our missing entries
 * are added (installer.ts `upgradeHooks`): hooks never installed stay so,
 * and the status line is not touched. The file is saved in the backups
 * first, and written whole or not at all. Never throws: false when nothing
 * was written, whatever the reason.
 */
export async function upgradeInstalledHooks(settingsPath: string, backupsDir: string, now = Date.now()): Promise<boolean> {
  try {
    const raw = await readFile(settingsPath, 'utf8');
    const before: unknown = JSON.parse(raw);
    const after = upgradeHooks(before);
    if (after === undefined) return false;
    // Same guard as the installer script: nothing that is not ours may move.
    if (JSON.stringify(foreignFingerprint(before)) !== JSON.stringify(foreignFingerprint(after))) return false;
    await mkdir(backupsDir, { recursive: true });
    await copyFile(settingsPath, join(backupsDir, `settings-${now}.json`));
    const tmp = `${settingsPath}.koh-vibe-${now}.tmp`;
    await writeFile(tmp, `${JSON.stringify(after, null, indentOf(raw))}\n`, 'utf8');
    await rename(tmp, settingsPath);
    return true;
  } catch {
    return false;
  }
}
