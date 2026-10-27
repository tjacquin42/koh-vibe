import * as vscode from 'vscode';
import { projectKey } from '../artifacts/projects';
import { otherLabel } from './artifact-labels';

/** What a row of the « Move to project » list stands for. */
export type ProjectChoice = { kind: 'project'; project: string } | { kind: 'new' } | { kind: 'other' };

/** A row of that list: the shape `showQuickPick` takes, and what it stands for. */
export interface ProjectPick extends vscode.QuickPickItem {
  choice: ProjectChoice;
}

/** What the choice asks the person — injected, so the sequence is testable without an editor. */
export interface ProjectPrompts {
  pick: (items: ProjectPick[]) => Promise<ProjectPick | undefined>;
  /** The name of a new project; `undefined` on Escape. */
  askName: () => Promise<string | undefined>;
}

/**
 * The list: every project by name, then a new one, then « Other ». `current`
 * marks where the artifact is now — a project, `null` for « Other », or
 * `undefined` when several artifacts are moved at once and no one place is
 * theirs.
 */
export function projectPicks(projects: readonly string[], current: string | null | undefined): ProjectPick[] {
  const here = vscode.l10n.t('current');
  const sorted = [...projects].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true }) || a.localeCompare(b));
  return [
    ...sorted.map((project) => ({
      label: `$(folder) ${project}`,
      description: project === current ? here : undefined,
      choice: { kind: 'project', project } as const,
    })),
    { label: `$(add) ${vscode.l10n.t('New project…')}`, description: undefined, choice: { kind: 'new' } as const },
    { label: `$(inbox) ${otherLabel()}`, description: current === null ? here : undefined, choice: { kind: 'other' } as const },
  ];
}

/**
 * A typed name as a project: blank is no answer, and the name « Other » goes
 * by means « Other » — not a second folder of that name beside it.
 */
export function projectName(typed: string | undefined): string | null | undefined {
  if (typed === undefined) return undefined;
  const name = typed.trim();
  if (name.length === 0) return undefined;
  return projectKey(name) === projectKey(otherLabel()) ? null : name;
}

/** The project chosen: a name, `null` for « Other », `undefined` when the choice was dropped. */
export async function chooseProject(
  projects: readonly string[],
  current: string | null | undefined,
  prompts: ProjectPrompts,
): Promise<string | null | undefined> {
  const picked = await prompts.pick(projectPicks(projects, current));
  if (picked === undefined) return undefined;
  if (picked.choice.kind === 'project') return picked.choice.project;
  if (picked.choice.kind === 'other') return null;
  return projectName(await prompts.askName());
}
