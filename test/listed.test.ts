import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { findTranscript, listingFolder, sessionListedIn } from '../src/claude/listed';
import { transcriptPathFor } from '../src/claude/rescan';

const ID = '9734f15a-0f40-47b1-aca4-290f307cfe0f';
const OTHER = 'c61c1f56-e79e-4be8-bf3e-3267935dcaae';

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
    expect(sessionListedIn(home, '/Users/dev/projet', ID)).toBe(true);
  });

  it('is false for a transcript filed under another project — a worktree, a reclassified session', () => {
    mkdirSync(join(home, 'projects', '-Users-dev-projet--worktrees-x'), { recursive: true });
    writeFileSync(transcriptPathFor(home, '/Users/dev/projet/.worktrees/x', ID), '', 'utf8');
    expect(sessionListedIn(home, '/Users/dev/projet', ID)).toBe(false);
  });

  it('is true for a conversation Claude Code archived: an archive leaves the session in the list', () => {
    // `buildSessionList` (extension 2.1.270) never drops an archived session:
    // it marks it `archived: true` and hands it over like the others. Treating
    // the archive as an absence sent months-old conversations to a terminal
    // instead of the tab that could have resumed them.
    const path = transcriptPathFor(home, '/Users/dev/projet', ID);
    mkdirSync(join(home, 'projects', '-Users-dev-projet'), { recursive: true });
    writeFileSync(path, '', 'utf8');
    expect(sessionListedIn(home, '/Users/dev/projet', ID)).toBe(true);
  });
});

describe('findTranscript — wherever Claude Code filed the conversation', () => {
  let home: string;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'koh-claude-'));
  });
  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  it('finds it under any project directory, and not at all when it was never written', async () => {
    mkdirSync(join(home, 'projects', '-Users-dev-projet'), { recursive: true });
    mkdirSync(join(home, 'projects', '-Users-dev-autre'), { recursive: true });
    const path = join(home, 'projects', '-Users-dev-autre', `${ID}.jsonl`);
    writeFileSync(path, '', 'utf8');
    expect(await findTranscript(home, ID)).toBe(path);
    expect(await findTranscript(home, OTHER)).toBeUndefined();
  });

  it('answers nothing for a home without projects, and for an id that is no id', async () => {
    expect(await findTranscript(join(home, 'absent'), ID)).toBeUndefined();
    expect(await findTranscript(home, '../etc')).toBeUndefined();
  });
});
