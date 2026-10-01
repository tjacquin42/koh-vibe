import { describe, expect, it } from 'vitest';
import { retitleArtifact, type ArtifactCalls, type ArtifactUi } from '../src/artifacts/actions';
import type { Artifact } from '../src/artifacts/model';

const artifact = (over: Partial<Artifact> = {}): Artifact => ({ slug: 'ArtTest01', title: 'Release notes', pinned: false, ...over });

/** Records every call in order. */
function harness(opts: { answer?: string; ok?: boolean } = {}) {
  const log: string[] = [];
  const calls: ArtifactCalls = {
    rename: async (slug, title) => {
      log.push(`rename ${slug} ${title}`);
      return opts.ok ?? true;
    },
    refresh: async () => {
      log.push('refresh');
    },
  };
  const ui: ArtifactUi = {
    askTitle: async (current) => {
      log.push(`ask ${current}`);
      return opts.answer;
    },
    done: (message) => {
      log.push(`done ${message}`);
    },
    failed: (message) => {
      log.push(`failed ${message}`);
    },
  };
  return { calls, ui, log };
}

describe('retitleArtifact', () => {
  it('asks for the title, prefilled, sends it folded, and reads the list again', async () => {
    const h = harness({ answer: '  Release\nnotes v2 ' });
    expect(await retitleArtifact(artifact(), h.calls, h.ui)).toBe('done');
    expect(h.log).toEqual(['ask Release notes', 'rename ArtTest01 Release notes v2', 'done Koh-Vibe: artifact renamed', 'refresh']);
  });

  it('sends nothing on Escape, an empty box, or the same title', async () => {
    for (const answer of [undefined, '   ', 'Release notes']) {
      const h = harness({ answer });
      expect(await retitleArtifact(artifact(), h.calls, h.ui)).toBe('skipped');
      expect(h.log).toEqual(['ask Release notes']);
    }
  });

  it('says it failed, and still reads the list again', async () => {
    const h = harness({ answer: 'Notes', ok: false });
    expect(await retitleArtifact(artifact(), h.calls, h.ui)).toBe('failed');
    expect(h.log).toEqual(['ask Release notes', 'rename ArtTest01 Notes', 'failed Could not rename “Release notes”.', 'refresh']);
  });
});
