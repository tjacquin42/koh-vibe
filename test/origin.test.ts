import { describe, expect, it } from 'vitest';
import { branchOf, originOf, projectOf } from '../src/events/origin';

describe('originOf', () => {
  it('recognises the known entrypoints', () => {
    expect(originOf('claude-vscode', '')).toBe('vscode');
    expect(originOf('claude-desktop', '')).toBe('desktop');
    expect(originOf('cli', 'ghostty')).toBe('terminal');
    expect(originOf('sdk-ts', '')).toBe('sdk');
    // sdk-cli : valeur réelle observée en capture headless (`claude -p`), Task 2.
    expect(originOf('sdk-cli', '')).toBe('sdk');
  });

  it('falls back to the host terminal, then to unknown', () => {
    expect(originOf('', 'vscode')).toBe('vscode');
    expect(originOf('', '')).toBe('unknown');
  });
});

describe('projectOf et branchOf', () => {
  it('takes the root folder outside a worktree', () => {
    expect(projectOf('/Users/dev/projet')).toBe('projet');
    expect(branchOf('/Users/dev/projet')).toBeUndefined();
  });

  it('walks back to the project from a worktree and reads the branch off it', () => {
    expect(projectOf('/Users/dev/projet/.worktrees/feat-seo')).toBe('projet');
    expect(branchOf('/Users/dev/projet/.worktrees/feat-seo')).toBe('feat-seo');
  });

  it('handles .claude-worktrees too', () => {
    expect(projectOf('/Users/dev/autre-projet/.claude-worktrees/analytics')).toBe('autre-projet');
    expect(branchOf('/Users/dev/autre-projet/.claude-worktrees/analytics')).toBe('analytics');
  });
});
