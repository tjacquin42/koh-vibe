import { describe, expect, it } from 'vitest';
import { blankSession } from '../src/store/blank';

describe('blankSession', () => {
  it('starts idle, with nothing counted, placed by its directory', () => {
    expect(blankSession('s1', '/Users/dev/projet', 'vscode', 42)).toEqual({
      id: 's1',
      cwd: '/Users/dev/projet',
      project: 'projet',
      origin: 'vscode',
      status: 'idle',
      toolCount: 0,
      lastEventAt: 42,
    });
  });

  it('names the branch only when the directory is a worktree', () => {
    // An absent key, never `undefined`: the object goes to disk as it is.
    const s = blankSession('s1', '/Users/dev/projet/.worktrees/feat-x', 'terminal', 0);
    expect(s.project).toBe('projet');
    expect(s.branch).toBe('feat-x');
    expect('branch' in blankSession('s2', '/Users/dev/projet', 'terminal', 0)).toBe(false);
  });
});
