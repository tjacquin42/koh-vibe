import { describe, expect, it } from 'vitest';
import { artifactUrl, isArtifact, parseArtifacts, sortArtifacts, type Artifact } from '../src/artifacts/model';

/** One row of the listing, as the endpoint returns it, with invented values. */
const frame = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  slug: 'ArtTest01',
  title: 'Release notes',
  favicon: 'doc',
  rel: 'mine',
  updatedAt: '2026-09-27T10:00:00.000Z',
  ...over,
});

describe('parseArtifacts', () => {
  it('reads the listing, the pins included when the server says it counts them', () => {
    expect(parseArtifacts({ frames: [frame({ starred: true })], starsEnabled: true })).toEqual({
      artifacts: [
        { slug: 'ArtTest01', title: 'Release notes', updatedAt: Date.parse('2026-09-27T10:00:00.000Z'), pinned: true },
      ],
      truncated: false,
    });
  });

  it('ignores a star when the server does not count them', () => {
    expect(parseArtifacts({ frames: [frame({ starred: true })] })?.artifacts[0]?.pinned).toBe(false);
  });

  it('keeps only the person own pages, and only the live ones', () => {
    const list = parseArtifacts({
      frames: [
        frame({ slug: 'kept' }),
        frame({ slug: 'shared', rel: 'shared' }),
        frame({ slug: 'gone', softDeleted: true }),
        frame({ slug: '' }),
        null,
      ],
    });
    expect(list?.artifacts.map((a) => a.slug)).toEqual(['kept']);
  });

  it('folds a title written on several lines, and leaves a missing one empty', () => {
    const [multi, none] = parseArtifacts({ frames: [frame({ slug: 'a', title: ' Release\n notes ' }), frame({ slug: 'b', title: undefined })] })!.artifacts;
    expect(multi?.title).toBe('Release notes');
    expect(none?.title).toBe('');
  });

  it('reads a missing list as empty, and anything else as not the listing', () => {
    expect(parseArtifacts({})).toEqual({ artifacts: [], truncated: false });
    for (const body of [undefined, null, [], { frames: 'x' }]) expect(parseArtifacts(body)).toBeUndefined();
  });

  it('takes a full page as a sign there may be more', () => {
    const frames = Array.from({ length: 200 }, (_, i) => frame({ slug: `a${i}` }));
    expect(parseArtifacts({ frames })?.truncated).toBe(true);
  });
});

describe('sortArtifacts', () => {
  const a = (slug: string, over: Partial<Artifact> = {}): Artifact => ({ slug, title: slug, pinned: false, ...over });

  it('puts the pinned first, then the most recently updated, the undated last', () => {
    const sorted = sortArtifacts([
      a('old', { updatedAt: 1 }),
      a('undated'),
      a('new', { updatedAt: 3 }),
      a('pin', { pinned: true, updatedAt: 2 }),
    ]);
    expect(sorted.map((x) => x.slug)).toEqual(['pin', 'new', 'old', 'undated']);
  });
});

describe('isArtifact', () => {
  it('accepts an artifact as the cache writes it back, and refuses the rest', () => {
    const [x] = parseArtifacts({ frames: [frame()] })!.artifacts;
    expect(isArtifact(JSON.parse(JSON.stringify(x)))).toBe(true);
    for (const v of [null, {}, { slug: 'a', title: 'b', pinned: 'no' }, { slug: 'a', title: 'b', pinned: true, updatedAt: 'x' }]) {
      expect(isArtifact(v)).toBe(false);
    }
  });
});

describe('artifactUrl', () => {
  it('points at the page on claude.ai — the form Claude Code itself lists', () => {
    expect(artifactUrl('ArtTest01')).toBe('https://claude.ai/artifact/ArtTest01');
  });
});
