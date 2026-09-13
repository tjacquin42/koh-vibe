import type { Origin } from './types';

const WORKTREE_MARKERS = ['.worktrees', '.claude-worktrees'];

export function originOf(entrypoint: string, termProgram: string): Origin {
  switch (entrypoint) {
    case 'claude-vscode':
      return 'vscode';
    case 'claude-desktop':
      return 'desktop';
    case 'cli':
      return 'terminal';
    case 'sdk-ts':
    case 'sdk-py':
    case 'sdk-cli':
      return 'sdk';
    default:
      return termProgram === 'vscode' ? 'vscode' : 'unknown';
  }
}

/**
 * Whether a conversation lives in an editor panel — the only origins a tab
 * can be revealed, closed or put to sleep for. `unknown` rather than `Origin`
 * because two of the three callers read it off a request file another window
 * wrote, not off a `Session`.
 */
export function isEditorOrigin(origin: unknown): origin is 'vscode' | 'desktop' {
  return origin === 'vscode' || origin === 'desktop';
}

function segments(cwd: string): string[] {
  return cwd.split('/').filter((p) => p.length > 0);
}

function worktreeIndex(parts: string[]): number {
  return parts.findIndex((p) => WORKTREE_MARKERS.includes(p));
}

/** The project's name: the root folder, going back up above a worktree. */
export function projectOf(cwd: string): string {
  const parts = segments(cwd);
  const wt = worktreeIndex(parts);
  const idx = wt > 0 ? wt - 1 : parts.length - 1;
  return parts[idx] ?? cwd;
}

/** The worktree's name, which doubles as the branch name. `undefined` on the main repository. */
export function branchOf(cwd: string): string | undefined {
  const parts = segments(cwd);
  const wt = worktreeIndex(parts);
  if (wt < 0) return undefined;
  return parts[wt + 1];
}
