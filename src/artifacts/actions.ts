import * as vscode from 'vscode';
import { foldedText } from '../lib/json';
import { artifactLabel } from '../ui/artifact-labels';
import type { Artifact } from './model';

/** What an action calls on claude.ai. */
export interface ArtifactCalls {
  rename: (slug: string, title: string) => Promise<boolean>;
  /** Reads the list again, forced: the view shows what the server says, never what we hoped. */
  refresh: () => Promise<void>;
}

/** What an action says to the person — injected, so the sequence is testable without an editor. */
export interface ArtifactUi {
  /** The new title, the current one prefilled; `undefined` on Escape. */
  askTitle: (current: string) => Promise<string | undefined>;
  /** A short-lived word in the status bar. */
  done: (message: string) => void;
  /** Something did not go through: a warning that can open the page. */
  failed: (message: string, artifact: Artifact) => void;
}

export type ChangeOutcome = 'skipped' | 'done' | 'failed';

/** Renames a page. No confirmation: renaming it back undoes it. */
export async function retitleArtifact(a: Artifact, calls: ArtifactCalls, ui: ArtifactUi): Promise<ChangeOutcome> {
  // Folded the way the listing folds titles (model.ts), so « the same title »
  // means the same thing on both sides.
  const title = foldedText(await ui.askTitle(a.title));
  // Escape, an empty box, or the same title: nothing to send. An empty title
  // is refused here rather than left to the server — the row would then read
  // « Untitled », a name nobody chose.
  if (title.length === 0 || title === a.title) return 'skipped';
  const ok = await calls.rename(a.slug, title);
  if (ok) ui.done(vscode.l10n.t('Koh-Vibe: artifact renamed'));
  else ui.failed(vscode.l10n.t('Could not rename “{0}”.', artifactLabel(a)), a);
  await calls.refresh();
  return ok ? 'done' : 'failed';
}
