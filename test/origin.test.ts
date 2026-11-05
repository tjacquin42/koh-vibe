import { describe, expect, it } from 'vitest';
import { branchOf, originOf, projectOf } from '../src/events/origin';

describe('originOf', () => {
  it('recognizes the known entrypoints', () => {
    expect(originOf('claude-vscode', '')).toBe('vscode');
    expect(originOf('claude-desktop', '')).toBe('desktop');
    expect(originOf('cli', 'ghostty')).toBe('terminal');
    expect(originOf('sdk-ts', '')).toBe('sdk');
    // sdk-cli: real value observed in headless capture (`claude -p`), Task 2.
    expect(originOf('sdk-cli', '')).toBe('sdk');
  });

  it('falls back to the host terminal, then to unknown', () => {
    expect(originOf('', 'vscode')).toBe('vscode');
    expect(originOf('', '')).toBe('unknown');
  });
});

describe('projectOf and branchOf', () => {
  it('takes the root folder outside a worktree', () => {
    expect(projectOf('/Users/dev/projet')).toBe('projet');
    expect(branchOf('/Users/dev/projet')).toBeUndefined();
  });

  it('goes back up to the project from a worktree and derives the branch from it', () => {
    expect(projectOf('/Users/dev/projet/.worktrees/feat-seo')).toBe('projet');
    expect(branchOf('/Users/dev/projet/.worktrees/feat-seo')).toBe('feat-seo');
  });

  it('also handles .claude-worktrees', () => {
    expect(projectOf('/Users/dev/autre-projet/.claude-worktrees/analytics')).toBe('autre-projet');
    expect(branchOf('/Users/dev/autre-projet/.claude-worktrees/analytics')).toBe('analytics');
  });
});
