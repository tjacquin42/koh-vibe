import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import * as vscode from 'vscode';
import { folderRulesFile } from '../paths';

/** The skill that knows where a folder's rules live and how to change them. */
export const RULES_SKILL = 'koh-vibe-folder-rules';

/**
 * A folder's rules file, created on first use with its folder named in the
 * header — what tells the skill, and whoever opens the file, which folder it
 * is. Never overwritten: the rules are the person's.
 */
export async function ensureRulesFile(home: string, groupId: string, folderName: string): Promise<string> {
  const path = folderRulesFile(home, groupId);
  await mkdir(dirname(path), { recursive: true });
  try {
    // `wx`: written only if absent, without a check-then-write race.
    await writeFile(path, `---\nfolder: ${folderName}\n---\n\n`, { encoding: 'utf8', flag: 'wx' });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
  }
  return path;
}

/**
 * The start of the conversation that adds a rule to a folder: a title — what
 * Claude Code names the conversation after — the skill, the folder, and the
 * question to ask. Left in the input, not sent.
 */
export function addRulePrompt(folderName: string, groupId: string): string {
  return vscode.l10n.t(
    'Folder rule — {0}\n\nUse the {1} skill. Koh-Vibe folder: « {0} » (id {2}).\nAsk me which rule to add to this folder.',
    folderName,
    RULES_SKILL,
    groupId,
  );
}
