import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildCommit, readBuildStamp, releaseLabel, versionLabel } from '../src/ui/version';

describe('releaseLabel', () => {
  it('returns the shipped version exactly as it is tagged', () => {
    expect(releaseLabel({ version: 'v0.2.0', ahead: 0 })).toBe('v0.2.0');
  });

  it('counts the commits that follow the last release', () => {
    expect(releaseLabel({ version: 'v0.2.0', ahead: 7 })).toBe('v0.2.0+7');
  });

  it('invents no gap when the count is missing or is not one', () => {
    expect(releaseLabel({ version: 'v0.2.0' })).toBe('v0.2.0');
    expect(releaseLabel({ version: 'v0.2.0', ahead: '7' })).toBe('v0.2.0');
    expect(releaseLabel({ version: 'v0.2.0', ahead: -1 })).toBe('v0.2.0');
  });

  it('with no tag, there is no version to show', () => {
    expect(releaseLabel({ ahead: 7 })).toBeUndefined();
    expect(releaseLabel({ version: '' })).toBeUndefined();
    expect(releaseLabel(null)).toBeUndefined();
    expect(releaseLabel(undefined)).toBeUndefined();
    expect(releaseLabel('v0.2.0')).toBeUndefined();
  });
});

describe('buildCommit', () => {
  it('returns the commit as is when the package matches it', () => {
    expect(buildCommit({ commit: '1736ec0', dirty: false })).toBe('1736ec0');
  });

  it('stars a package that does not match its commit', () => {
    expect(buildCommit({ commit: '1736ec0', dirty: true })).toBe('1736ec0*');
  });

  it('stars on a real boolean only: a dubious value is not worth an alarm', () => {
    expect(buildCommit({ commit: '1736ec0', dirty: 'oui' })).toBe('1736ec0');
    expect(buildCommit({ commit: '1736ec0' })).toBe('1736ec0');
  });

  it('with no commit, there is nothing to show — not even a star', () => {
    expect(buildCommit({ dirty: true })).toBeUndefined();
    expect(buildCommit({ commit: '' })).toBeUndefined();
    expect(buildCommit(null)).toBeUndefined();
  });
});

describe('versionLabel', () => {
  it('puts the shipped version and the commit side by side', () => {
    expect(versionLabel({ version: 'v0.2.0', ahead: 0, commit: '1736ec0', dirty: false })).toBe('v0.2.0 · 1736ec0');
  });

  it('carries the gap and the star together when both are warranted', () => {
    expect(versionLabel({ version: 'v0.2.0', ahead: 3, commit: '1736ec0', dirty: true })).toBe('v0.2.0+3 · 1736ec0*');
  });

  it('says no version has shipped rather than borrowing one', () => {
    expect(versionLabel({ commit: '1736ec0', dirty: false })).toBe('no version · 1736ec0');
  });

  it('stays displayable with no stamp at all', () => {
    expect(versionLabel(undefined)).toBe('no version');
  });
});

describe('readBuildStamp', () => {
  it('reads the file laid at the package root', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'koh-version-'));
    await writeFile(join(dir, 'build-info.json'), '{"commit":"abc1234","dirty":false}', 'utf8');
    expect(await readBuildStamp(dir)).toEqual({ commit: 'abc1234', dirty: false });
  });

  it('treats a missing or unreadable file as an absence, never as an error', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'koh-version-'));
    expect(await readBuildStamp(dir)).toBeUndefined();
    await writeFile(join(dir, 'build-info.json'), 'ce n\'est pas du JSON', 'utf8');
    expect(await readBuildStamp(dir)).toBeUndefined();
  });
});
