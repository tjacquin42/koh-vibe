import { describe, expect, it } from 'vitest';
import { claims, sessionsToAcknowledge } from '../src/focus/claims';
import type { Session } from '../src/events/types';

describe('claims', () => {
  const folders = ['/Users/dev/projet', '/Users/dev/autre-projet'];

  it('claims a session inside a workspace folder', () => {
    expect(claims(folders, '/Users/dev/projet')).toBe(true);
    expect(claims(folders, '/Users/dev/projet/web')).toBe(true);
  });

  it('claims a worktree sitting under the folder', () => {
    expect(claims(folders, '/Users/dev/projet/.worktrees/feat-seo')).toBe(true);
  });

  it('does not claim a neighbouring project whose prefix looks alike', () => {
    expect(claims(folders, '/Users/dev/projet-old')).toBe(false);
  });

  it('claims nothing when no folder is open', () => {
    expect(claims([], '/Users/dev/projet')).toBe(false);
  });

  it('claims regardless of case (macOS is case-insensitive)', () => {
    expect(claims(folders, '/users/dev/projet')).toBe(true);
    expect(claims(folders, '/Users/dev/PROJET/web')).toBe(true);
  });

  it('still does not claim the misleading prefix, even in a different case', () => {
    expect(claims(folders, '/Users/dev/PROJET-old')).toBe(false);
  });
});

// I6 : la spec (§5) acquitte « terminé non lu » à l'affichage de la vue
// seulement pour la fenêtre qui revendique la session — pas pour toutes les
// sessions de tous les projets. Extraite en fonction pure (même raison que
// claims() elle-même) pour rester testable sans vscode : c'est exactement la
// logique câblée dans onDidChangeVisibility (extension.ts).
describe('sessionsToAcknowledge', () => {
  const base: Session = {
    id: 's', cwd: '/Users/dev/projet', project: 'projet', origin: 'vscode',
    status: 'done_unseen', toolCount: 0, lastEventAt: 0,
  };
  const folders = ['/Users/dev/projet'];

  it('keeps the unread finished sessions these folders claim', () => {
    const claimed: Session = { ...base, id: 'a', cwd: '/Users/dev/projet' };
    const foreign: Session = { ...base, id: 'b', cwd: '/Users/dev/autre-projet' };
    expect(sessionsToAcknowledge([claimed, foreign], folders)).toEqual([claimed]);
  });

  it('ignores a claimed session that is not an unread finished one', () => {
    const running: Session = { ...base, id: 'a', status: 'running' };
    expect(sessionsToAcknowledge([running], folders)).toEqual([]);
  });

  it('keeps nothing when no folder is open', () => {
    expect(sessionsToAcknowledge([base], [])).toEqual([]);
  });
});
