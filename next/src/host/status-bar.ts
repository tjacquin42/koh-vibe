import * as vscode from 'vscode';
import type { Snapshot } from '../shared/protocol';
import { SIDEBAR_VIEW } from './ids';

export interface StatusText {
  text: string;
  waiting: number;
  total: number;
}

/**
 * The counter in the status bar, as V1 draws it: waiting, working, finished;
 * a plain total when none of the three; nothing at all with no conversation.
 * Ended conversations count for nothing — they are history, not work.
 */
export function statusText(snap: Snapshot): StatusText | undefined {
  const open = snap.sessions.filter((s) => s.endedAt === undefined);
  if (open.length === 0) return undefined;
  const n = (status: string): number => open.filter((s) => s.status === status).length;
  const waiting = n('waiting');
  const running = n('running');
  const done = n('done_unseen');
  const parts: string[] = [];
  if (waiting > 0) parts.push(`$(question) ${waiting}`);
  if (running > 0) parts.push(`$(circle-filled) ${running}`);
  if (done > 0) parts.push(`$(check) ${done}`);
  return { text: parts.length > 0 ? parts.join(' · ') : `$(circle-outline) ${open.length}`, waiting, total: open.length };
}

export function createStatusBar(): { update(snap: Snapshot): void; dispose(): void } {
  // Priority just under V1's (50) so the two sit side by side while both run.
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 49);
  item.name = 'Koh-Vibe Next';
  item.command = `${SIDEBAR_VIEW}.focus`;
  return {
    update(snap) {
      const s = statusText(snap);
      if (s === undefined) {
        item.hide();
        return;
      }
      item.text = s.text;
      item.tooltip =
        s.total > 1 ? vscode.l10n.t('Koh-Vibe Next — {0} sessions', s.total) : vscode.l10n.t('Koh-Vibe Next — {0} session', s.total);
      item.backgroundColor = s.waiting > 0 ? new vscode.ThemeColor('statusBarItem.warningBackground') : undefined;
      item.show();
    },
    dispose: () => item.dispose(),
  };
}
