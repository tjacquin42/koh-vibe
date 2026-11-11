import * as vscode from 'vscode';
import type { ClosedEntry } from '../closed/model';
import type { Session } from '../events/types';
import type { Group } from '../groups/model';
import { sessionLabel } from './labels';
import type { FolderArtifact } from './tree';

/** What a search result leads to. */
export type SearchTarget =
  | { kind: 'session'; session: Session }
  | { kind: 'artifact'; slug: string }
  | { kind: 'closed'; entry: ClosedEntry };

/** A line of the search list; a separator carries no target. */
export interface SearchItem extends vscode.QuickPickItem {
  target?: SearchTarget;
}

/** What the search lists, gathered by the caller from the views. */
export interface SearchSources {
  sessions: readonly Session[];
  /** The folder a session is filed in, if any. */
  folderOf: (sessionId: string) => Group | undefined;
  artifacts: readonly { artifact: FolderArtifact; group: Group }[];
  closed: readonly ClosedEntry[];
}

function where(s: { project: string; branch?: string }): string {
  return s.branch === undefined ? s.project : `${s.project} · ${s.branch}`;
}

function separator(label: string): SearchItem {
  return { label, kind: vscode.QuickPickItemKind.Separator };
}

/**
 * The search list: the conversations of the Sessions view, the artifacts filed
 * in its folders, then the recently closed conversations — each under its own
 * separator, each with a glyph that says what it is. The folder goes in the
 * description and the project in the detail, both matched on: typing a
 * folder's name lists what it holds.
 */
export function searchItems(src: SearchSources): SearchItem[] {
  const out: SearchItem[] = [];
  if (src.sessions.length > 0) {
    out.push(separator(vscode.l10n.t('Conversations')));
    for (const session of src.sessions) {
      const folder = src.folderOf(session.id);
      out.push({
        // A live conversation and a greyed one do not look alike in the view;
        // they should not here either.
        label: `$(${session.endedAt === undefined ? 'comment-discussion' : 'circle-slash'}) ${sessionLabel(session)}`,
        description: folder === undefined ? vscode.l10n.t('Temporary sessions') : `$(symbol-folder) ${folder.name}`,
        detail: where(session),
        target: { kind: 'session', session },
      });
    }
  }
  if (src.artifacts.length > 0) {
    out.push(separator(vscode.l10n.t('Artifacts')));
    for (const { artifact, group } of src.artifacts) {
      out.push({
        label: `$(book) ${artifact.title.length > 0 ? artifact.title : vscode.l10n.t('Untitled')}`,
        description: `$(symbol-folder) ${group.name}`,
        detail: vscode.l10n.t('Artifact on claude.ai'),
        target: { kind: 'artifact', slug: artifact.slug },
      });
    }
  }
  if (src.closed.length > 0) {
    out.push(separator(vscode.l10n.t('Recently closed')));
    for (const entry of src.closed) {
      out.push({
        label: `$(history) ${sessionLabel(entry)}`,
        description: vscode.l10n.t('closed'),
        detail: where(entry),
        target: { kind: 'closed', entry },
      });
    }
  }
  return out;
}
