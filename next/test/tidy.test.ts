import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readArtifactProjects } from '../../src/artifacts/projects-store';
import { applyMoves, ensureTidyRulesFile, parseMoves, readTidyRules, rulesOf, tidyPrompt, tidyRulesFile, type TidyItem } from '../src/host/tidy';
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

  it('reads its rules from a Markdown file: a bullet each, its indented lines with it', () => {
    const text = '---\nfor: Koh-Vibe artifact tidying\n---\n\n# Mes règles\n\n- Les recettes vont dans Cuisine\n- Les plans koh-vibe vont\n  dans Koh, même déjà rangés\n\nUne ligne sans tiret compte aussi\n';
    expect(rulesOf(text)).toEqual(['Les recettes vont dans Cuisine', 'Les plans koh-vibe vont dans Koh, même déjà rangés', 'Une ligne sans tiret compte aussi']);
    expect(rulesOf('---\nfor: x\n---\n\n')).toEqual([]);
  });

  it('creates the file once, with the rules kept before, and never overwrites it', async () => {
    const home = await makeHome();
    const file = tidyRulesFile(home);
    expect(await readTidyRules(file)).toEqual([]);
    await ensureTidyRulesFile(file, ['Les recettes vont dans Cuisine']);
    expect(await readTidyRules(file)).toEqual(['Les recettes vont dans Cuisine']);
    await writeFile(file, (await readFile(file, 'utf8')) + '- Une autre\n');
    await ensureTidyRulesFile(file, ['Écrasée ?']);
    expect(await readTidyRules(file)).toEqual(['Les recettes vont dans Cuisine', 'Une autre']);
  });
});
