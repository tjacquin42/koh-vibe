import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CLAUDE_STATE_KEY, listingFolder, parseHiddenSessionIds, sessionListedIn } from '../src/claude/listed';
import { transcriptPathFor } from '../src/claude/rescan';

const ID = '9734f15a-0f40-47b1-aca4-290f307cfe0f';
const OTHER = 'c61c1f56-e79e-4be8-bf3e-3267935dcaae';

describe('parseHiddenSessionIds — what the user hid from Claude Code\'s own session list', () => {
  it('reads the ids out of the extension\'s global state, as the editor stores it', () => {
    // The key the editor files the extension's state under, observed on the
    // state database: capital A, unlike the extension id in the manifest.
    expect(CLAUDE_STATE_KEY).toBe('Anthropic.claude-code');
    const raw = JSON.stringify({ settingsMigrated20251024: true, hiddenSessionIds: [ID, OTHER, 'not an id', 42] });
    expect([...parseHiddenSessionIds(raw)]).toEqual([ID, OTHER]);
  });

  it('reads nothing at all — no state, garbage, no such field — as "nothing hidden"', () => {
    expect(parseHiddenSessionIds(undefined).size).toBe(0);
    expect(parseHiddenSessionIds('{ broken').size).toBe(0);
    expect(parseHiddenSessionIds('[]').size).toBe(0);
    expect(parseHiddenSessionIds('{"hiddenSessionIds":"nope"}').size).toBe(0);
  });
});

describe('listingFolder — the folder Claude Code lists sessions for', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'koh-listed-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('is the first workspace folder, resolved through its symlinks like the extension does', () => {
    mkdirSync(join(dir, 'real'));
    symlinkSync(join(dir, 'real'), join(dir, 'link'));
    expect(listingFolder([join(dir, 'link'), '/elsewhere'])).toBe(listingFolder([join(dir, 'real')]));
  });

  it('falls back to the home directory without a folder, and keeps a folder it cannot resolve', () => {
    expect(listingFolder([], '/Users/dev')).toBe('/Users/dev');
    expect(listingFolder(['/no/such/folder'])).toBe('/no/such/folder');
  });
});

describe('sessionListedIn — would the editor command resume it, or start a blank one?', () => {
  let home: string;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'koh-claude-'));
  });
  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  it('is true when the transcript sits under the folder\'s own project directory', () => {
    const path = transcriptPathFor(home, '/Users/dev/projet', ID);
    mkdirSync(join(home, 'projects', '-Users-dev-projet'), { recursive: true });
    writeFileSync(path, '', 'utf8');
    expect(sessionListedIn(home, '/Users/dev/projet', ID, new Set())).toBe(true);
  });

  it('is false for a transcript filed under another project — a worktree, a reclassified session', () => {
    mkdirSync(join(home, 'projects', '-Users-dev-projet--worktrees-x'), { recursive: true });
    writeFileSync(transcriptPathFor(home, '/Users/dev/projet/.worktrees/x', ID), '', 'utf8');
    expect(sessionListedIn(home, '/Users/dev/projet', ID, new Set())).toBe(false);
  });

  it('is false for an id the user hid, transcript or not', () => {
    expect(sessionListedIn(home, '/Users/dev/projet', ID, new Set([ID]), () => true)).toBe(false);
  });
});
