import { describe, expect, it } from 'vitest';
import { claims, sessionsToAcknowledge } from '../src/focus/claims';
import type { Session } from '../src/events/types';

describe('claims', () => {
  const folders = ['/Users/dev/projet', '/Users/dev/autre-projet'];

  it('claims a session in a workspace folder', () => {
    expect(claims(folders, '/Users/dev/projet')).toBe(true);
    expect(claims(folders, '/Users/dev/projet/web')).toBe(true);
  });

  it('claims a worktree located under the folder', () => {
    expect(claims(folders, '/Users/dev/projet/.worktrees/feat-seo')).toBe(true);
  });

  it('does not claim a neighboring project with a misleading prefix', () => {
    expect(claims(folders, '/Users/dev/projet-old')).toBe(false);
  });

  it('claims nothing without an open folder', () => {
    expect(claims([], '/Users/dev/projet')).toBe(false);
  });

  it('claims regardless of case (macOS is case-insensitive)', () => {
    expect(claims(folders, '/users/dev/projet')).toBe(true);
    expect(claims(folders, '/Users/dev/PROJET/web')).toBe(true);
  });

  it('still does not claim the misleading prefix, even with different casing', () => {
    expect(claims(folders, '/Users/dev/PROJET-old')).toBe(false);
  });
});

// I6: the spec (§5) acknowledges "unread finished" when the view is shown
// only for the window that claims the session — not for every session in
// every project. Extracted as a pure function (same reason as claims()
// itself) to stay testable without vscode: it is exactly the logic wired
// into onDidChangeVisibility (extension.ts).
describe('sessionsToAcknowledge', () => {
  const base: Session = {
    id: 's', cwd: '/Users/dev/projet', project: 'projet', origin: 'vscode',
    status: 'done_unseen', toolCount: 0, lastEventAt: 0,
  };
  const folders = ['/Users/dev/projet'];

  it('keeps the unread finished sessions that these folders claim', () => {
    const claimed: Session = { ...base, id: 'a', cwd: '/Users/dev/projet' };
    const foreign: Session = { ...base, id: 'b', cwd: '/Users/dev/autre-projet' };
    expect(sessionsToAcknowledge([claimed, foreign], folders)).toEqual([claimed]);
  });

  it('ignores a session that is claimed but not an unread finished one', () => {
    const running: Session = { ...base, id: 'a', status: 'running' };
    expect(sessionsToAcknowledge([running], folders)).toEqual([]);
  });

  it('keeps nothing without an open folder', () => {
    expect(sessionsToAcknowledge([base], [])).toEqual([]);
  });
});
