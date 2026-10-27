import { describe, expect, it, vi } from 'vitest';
import { chooseProject, projectName, projectPicks, type ProjectPick } from '../src/ui/project-picks';

describe('projectPicks', () => {
  it('offers the projects by name, then a new one, then Other — marking where the artifact is now', () => {
    const picks = projectPicks(['Vetibble', 'koh-vibe', 'NTI'], 'NTI');
    expect(picks.map((p) => p.label)).toEqual(['$(folder) koh-vibe', '$(folder) NTI', '$(folder) Vetibble', '$(add) New project…', '$(inbox) Other']);
    expect(picks.map((p) => p.description)).toEqual([undefined, 'current', undefined, undefined, undefined]);
  });

  it('marks Other when the artifact is there, and nothing for several artifacts at once', () => {
    expect(projectPicks(['NTI'], null).map((p) => p.description)).toEqual([undefined, undefined, 'current']);
    expect(projectPicks(['NTI'], undefined).every((p) => p.description === undefined)).toBe(true);
  });
});

describe('projectName', () => {
  it('reads a typed name as a project, trimmed — nothing typed as no answer', () => {
    expect(projectName('  Salon 3D ')).toBe('Salon 3D');
    expect(projectName('   ')).toBeUndefined();
    expect(projectName(undefined)).toBeUndefined();
  });

  it('reads the name of Other as Other, rather than as a second folder beside it', () => {
    expect(projectName('other')).toBeNull();
  });
});

describe('chooseProject', () => {
  const choosing = (pickLabel: string | undefined, typed?: string) => {
    const askName = vi.fn(async () => typed);
    const pick = async (items: ProjectPick[]): Promise<ProjectPick | undefined> => items.find((i) => i.label === pickLabel);
    return { prompts: { pick, askName }, askName };
  };

  it('returns the project picked, or null for Other', async () => {
    expect(await chooseProject(['NTI'], undefined, choosing('$(folder) NTI').prompts)).toBe('NTI');
    expect(await chooseProject(['NTI'], undefined, choosing('$(inbox) Other').prompts)).toBeNull();
  });

  it('asks the name of a new project, and only then', async () => {
    const { prompts, askName } = choosing('$(add) New project…', 'Salon 3D');
    expect(await chooseProject(['NTI'], undefined, prompts)).toBe('Salon 3D');
    expect(askName).toHaveBeenCalledOnce();
    expect(choosing('$(folder) NTI').askName).not.toHaveBeenCalled();
  });

  it('drops the choice on Escape, at either step', async () => {
    expect(await chooseProject(['NTI'], undefined, choosing(undefined).prompts)).toBeUndefined();
    expect(await chooseProject(['NTI'], undefined, choosing('$(add) New project…', undefined).prompts)).toBeUndefined();
  });
});
