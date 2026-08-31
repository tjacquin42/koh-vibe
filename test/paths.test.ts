import { describe, expect, it } from 'vitest';
import { claudeHome, claudeSessionsDir, closedFile, groupsFile, kohVibeHome, spoolDirs } from '../src/paths';

describe('paths', () => {
  it('uses KOH_VIBE_HOME when it is set', () => {
    expect(kohVibeHome({ KOH_VIBE_HOME: '/tmp/koh' })).toBe('/tmp/koh');
  });

  it('falls back to ~/.koh-vibe', () => {
    expect(kohVibeHome({ HOME: '/Users/x' })).toBe('/Users/x/.koh-vibe');
  });

  it('derives the five subfolders', () => {
    expect(spoolDirs('/tmp/koh').events).toBe('/tmp/koh/events');
    expect(spoolDirs('/tmp/koh').sessions).toBe('/tmp/koh/sessions');
    expect(spoolDirs('/tmp/koh').requests).toBe('/tmp/koh/requests');
    expect(spoolDirs('/tmp/koh').rejected).toBe('/tmp/koh/events/rejected');
    expect(spoolDirs('/tmp/koh').backups).toBe('/tmp/koh/backups');
  });

  it('puts the folder filing at the root of the state', () => {
    expect(groupsFile('/tmp/koh')).toBe('/tmp/koh/groups.json');
  });

  it('puts the closed list at the root of the koh-vibe home', () => {
    expect(closedFile('/home/x/.koh-vibe')).toBe('/home/x/.koh-vibe/closed.json');
  });
});

describe('claude paths', () => {
  it('honours CLAUDE_CONFIG_DIR, the variable Claude Code itself reads', () => {
    expect(claudeHome({ CLAUDE_CONFIG_DIR: '/tmp/claude', HOME: '/Users/x' })).toBe('/tmp/claude');
  });

  it('falls back to ~/.claude', () => {
    expect(claudeHome({ HOME: '/Users/x' })).toBe('/Users/x/.claude');
    expect(claudeHome({ HOME: '/Users/x', CLAUDE_CONFIG_DIR: '' })).toBe('/Users/x/.claude');
  });

  it('finds the session registry under it', () => {
    expect(claudeSessionsDir('/Users/x/.claude')).toBe('/Users/x/.claude/sessions');
  });
});
