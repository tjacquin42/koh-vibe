import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readArtifactProjects } from '../../src/artifacts/projects-store';
import { applyMoves, parseMoves, tidyPrompt, type TidyItem } from '../src/host/tidy';
import { makeHome } from './home';

const items: TidyItem[] = [
  { slug: 'a1', title: 'Plan Koh-Vibe V2' },
  { slug: 'a2', title: 'Tri de koh-vibe', project: 'Koh' },
  { slug: 'a3', title: 'Recette du pain' },
];

describe('the tidying agent', () => {
  it('is told the projects, the rules and the pages, and to answer moves only', () => {
    const p = tidyPrompt(items, ['Koh'], ['Les recettes vont dans Cuisine']);
    expect(p).toContain('"Koh"');
    expect(p).toContain('Les recettes vont dans Cuisine');
    expect(p).toContain('"slug":"a3","title":"Recette du pain","project":null');
    expect(p).toContain('{"moves":[');
  });

  it('keeps only moves it can apply: a known page, a sane name, a real change', () => {
    const answer = 'Here:\n```json\n{"moves":[{"slug":"a1","project":"Koh"},{"slug":"a2","project":"koh"},{"slug":"zz","project":"X"},{"slug":"a3","project":"  "},{"slug":"a3","project":"Cuisine"}]}\n```';
    expect(parseMoves(answer, items)).toEqual([
      { slug: 'a1', project: 'Koh' },
      { slug: 'a3', project: 'Cuisine' },
    ]);
    expect(parseMoves('no json', items)).toEqual([]);
    expect(parseMoves('{"moves": 3}', items)).toEqual([]);
  });

  it('files every move in one write, through V1 store', async () => {
    const home = await makeHome();
    const file = join(home, 'artifact-projects.json');
    await applyMoves(file, [
      { slug: 'x', project: 'Cuisine' },
      { slug: 'y', project: 'Cuisine' },
    ]);
    const s = await readArtifactProjects(file);
    expect(s.filed['x']).toBe('Cuisine');
    expect(s.filed['y']).toBe('Cuisine');
  });
});
