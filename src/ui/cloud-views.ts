import { homedir } from 'node:os';
import * as vscode from 'vscode';
import { pinArtifact, retitleArtifact, type ArtifactCalls, type ArtifactUi } from '../artifacts/actions';
import { listArtifacts, renameArtifact, setArtifactPinned } from '../artifacts/api';
import { artifactUrl, isArtifact, type Artifact } from '../artifacts/model';
import { fileArtifacts, knownProjects, projectOfArtifact, renameFolder } from '../artifacts/projects';
import { readArtifactProjects, updateArtifactProjects } from '../artifacts/projects-store';
import { fileNewArtifacts, type PublishedArtifact } from '../artifacts/publish';
import { readCredentials, type CloudDeps } from '../cloud/account';
import { Feed } from '../cloud/feed';
import { logged } from '../cloud/log';
import { send } from '../cloud/request';
import { artifactProjectsFile, artifactsFile, routinesFile } from '../paths';
import { launchRoutine, pauseRoutine, type RoutineCalls, type RoutineUi } from '../routines/actions';
import { listRoutines, runRoutine, setRoutineEnabled } from '../routines/api';
import { isRoutine, routineUrl, type Routine } from '../routines/model';
import { ArtifactsTree, artifactSlugOfNode, projectOfNode, selectedSlugs } from './artifacts-tree';
import { feedDescription } from './feed-labels';
import { chooseProject, projectName } from './project-picks';
import { RoutinesTree, routineIdOfNode } from './routines-tree';

/** What the dashboard calls on these views. */
export interface CloudViews {
  /** The one call the render loop makes. */
  render: () => Promise<void>;
  /** Files the artifacts a drain saw published under their session's project. */
  filePublished: (published: readonly PublishedArtifact[]) => Promise<void>;
  /** The title the Artifacts view last read for a page, if it has one. */
  artifactTitle: (slug: string) => string | undefined;
}

/** Files pages in a folder of the Sessions view — the folder is asked for by the caller. */
export type FileInSessionsFolder = (items: { slug: string; title: string }[]) => Promise<void>;

/**
 * The views of what lives on claude.ai rather than on this machine.
 *
 * Out of extension.ts on purpose: this module owns its feeds, its trees and
 * its commands, and needs nothing from the dashboard but a way to ask for a
 * new render. What it hands back is the one call the render loop makes.
 *
 * A view asks claude.ai only while it is open. Collapsed, it costs no keychain
 * read and no request — which is what lets it ship, collapsed, to every user,
 * including the ones who will never open it.
 */
export function registerCloudViews(
  context: vscode.ExtensionContext,
  home: string,
  render: () => Promise<void>,
  fileInSessionsFolder: FileInSessionsFolder,
): CloudViews {
  // Where a failed call says what failed. The endpoints are undocumented; the
  // day one changes, this channel is the only place that tells which call
  // broke, and how (cloud/log.ts).
  const channel = vscode.window.createOutputChannel('Koh-Vibe');
  const cloud: CloudDeps = {
    send: logged(send, (line) => channel.appendLine(line)),
    credentials: () => readCredentials(),
  };

  const routinesFeed = new Feed<Routine>(routinesFile(home), isRoutine, {
    fetch: () => listRoutines(cloud),
    now: () => Date.now(),
  });
  const routinesTree = new RoutinesTree();
  const routinesView = vscode.window.createTreeView('kohVibe.routines', { treeDataProvider: routinesTree });
  const artifactsFeed = new Feed<Artifact>(artifactsFile(home), isArtifact, {
    fetch: () => listArtifacts(cloud),
    now: () => Date.now(),
  });
  // Which project each artifact is filed under — on this machine, since
  // claude.ai has no folders for them (artifacts/projects.ts).
  const projectsFile = artifactProjectsFile(home);
  /** Files pages into a project, or into « Other » with `null` — a drop and the menu both end here. */
  const fileInto = async (slugs: string[], project: string | null): Promise<void> => {
    try {
      await updateArtifactProjects(projectsFile, (s) => fileArtifacts(s, slugs, project));
    } catch (err) {
      channel.appendLine(`${new Date().toISOString()} artifact projects → ${err instanceof Error ? err.message : String(err)}`);
      void vscode.window.showWarningMessage(vscode.l10n.t('Koh-Vibe: could not file the artifacts.'));
    }
    await render();
  };
  const artifactsTree = new ArtifactsTree(fileInto);
  const artifactsView = vscode.window.createTreeView('kohVibe.artifacts', {
    treeDataProvider: artifactsTree,
    dragAndDropController: artifactsTree,
    // Several pages at once: filed together by a drag or by the menu.
    canSelectMany: true,
  });

  const open = (url: string): void => {
    void vscode.env.openExternal(vscode.Uri.parse(url));
  };
  const copy = async (url: string): Promise<void> => {
    await vscode.env.clipboard.writeText(url);
    vscode.window.setStatusBarMessage(vscode.l10n.t('Koh-Vibe: link copied'), 3000);
  };

  /**
   * A notification whose one button opens the page on claude.ai — where a
   * run's progress, or the reason something was refused, can be read.
   */
  const offerOpen = (url: string, message: string, warning: boolean): void => {
    const label = vscode.l10n.t('Open on claude.ai');
    const shown = warning
      ? vscode.window.showWarningMessage(message, label)
      : vscode.window.showInformationMessage(message, label);
    void shown.then((answer) => {
      if (answer === label) open(url);
    });
  };

  /** The routine a row names, taken from the list on screen — never the copy a stale row carries. */
  const routineAt = (node: unknown): Routine | undefined => {
    const id = routineIdOfNode(node);
    return id === undefined ? undefined : routinesTree.routine(id);
  };
  const routineCalls: RoutineCalls = {
    run: (id) => runRoutine(id, cloud),
    setEnabled: (id, enabled) => setRoutineEnabled(id, enabled, cloud),
    refresh: async () => {
      await routinesFeed.refresh(true);
      await render();
    },
  };
  const routineUi: RoutineUi = {
    confirmRun: async (r) => {
      const go = vscode.l10n.t('Run now');
      const answer = await vscode.window.showWarningMessage(
        vscode.l10n.t('Run “{0}” now?', r.name),
        {
          modal: true,
          detail: vscode.l10n.t(
            'The run starts in the cloud right away and does everything the routine does — messages, commits, whatever its prompt says.',
          ),
        },
        go,
      );
      return answer === go;
    },
    done: (message) => {
      vscode.window.setStatusBarMessage(message, 3000);
    },
    launched: (r) => offerOpen(routineUrl(r.id), vscode.l10n.t('Koh-Vibe: “{0}” launched', r.name), false),
    failed: (message, r) => offerOpen(routineUrl(r.id), message, true),
  };

  /** The artifact a row names, taken from the list on screen. */
  const artifactAt = (node: unknown): Artifact | undefined => {
    const slug = artifactSlugOfNode(node);
    return slug === undefined ? undefined : artifactsTree.artifact(slug);
  };
  const artifactCalls: ArtifactCalls = {
    rename: (slug, title) => renameArtifact(slug, title, cloud),
    setPinned: (slug, pinned) => setArtifactPinned(slug, pinned, cloud),
    refresh: async () => {
      await artifactsFeed.refresh(true);
      await render();
    },
  };
  const artifactUi: ArtifactUi = {
    askTitle: async (current) => vscode.window.showInputBox({ prompt: vscode.l10n.t('New title'), value: current }),
    done: (message) => {
      vscode.window.setStatusBarMessage(message, 3000);
    },
    failed: (message, a) => offerOpen(artifactUrl(a.slug), message, true),
  };

  context.subscriptions.push(
    channel,
    routinesTree,
    routinesView,
    // Opening the view is what starts its first read: nothing is asked while it is collapsed.
    routinesView.onDidChangeVisibility((e) => {
      if (e.visible) void render();
    }),
    vscode.commands.registerCommand('kohVibe.refreshRoutines', async () => {
      await routinesFeed.refresh(true);
      await render();
    }),
    // A click passes the row, and so does the context menu: one reader for both.
    vscode.commands.registerCommand('kohVibe.openRoutine', (node: unknown) => {
      const id = routineIdOfNode(node);
      if (id !== undefined) open(routineUrl(id));
    }),
    vscode.commands.registerCommand('kohVibe.copyRoutineLink', async (node: unknown) => {
      const id = routineIdOfNode(node);
      if (id !== undefined) await copy(routineUrl(id));
    }),
    vscode.commands.registerCommand('kohVibe.runRoutine', async (node: unknown) => {
      const r = routineAt(node);
      if (r !== undefined) await launchRoutine(r, routineCalls, routineUi);
    }),
    vscode.commands.registerCommand('kohVibe.pauseRoutine', async (node: unknown) => {
      const r = routineAt(node);
      if (r !== undefined) await pauseRoutine(r, true, routineCalls, routineUi, Date.now());
    }),
    vscode.commands.registerCommand('kohVibe.resumeRoutine', async (node: unknown) => {
      const r = routineAt(node);
      if (r !== undefined) await pauseRoutine(r, false, routineCalls, routineUi, Date.now());
    }),
    artifactsTree,
    artifactsView,
    artifactsView.onDidChangeVisibility((e) => {
      if (e.visible) void render();
    }),
    vscode.commands.registerCommand('kohVibe.refreshArtifacts', async () => {
      await artifactsFeed.refresh(true);
      await render();
    }),
    vscode.commands.registerCommand('kohVibe.openArtifact', (node: unknown) => {
      const slug = artifactSlugOfNode(node);
      if (slug !== undefined) open(artifactUrl(slug));
    }),
    vscode.commands.registerCommand('kohVibe.copyArtifactLink', async (node: unknown) => {
      const slug = artifactSlugOfNode(node);
      if (slug !== undefined) await copy(artifactUrl(slug));
    }),
    vscode.commands.registerCommand('kohVibe.renameArtifact', async (node: unknown) => {
      const a = artifactAt(node);
      if (a !== undefined) await retitleArtifact(a, artifactCalls, artifactUi);
    }),
    vscode.commands.registerCommand('kohVibe.pinArtifact', async (node: unknown) => {
      const a = artifactAt(node);
      if (a !== undefined) await pinArtifact(a, true, artifactCalls, artifactUi);
    }),
    vscode.commands.registerCommand('kohVibe.unpinArtifact', async (node: unknown) => {
      const a = artifactAt(node);
      if (a !== undefined) await pinArtifact(a, false, artifactCalls, artifactUi);
    }),
    // The row clicked, and the selection: the whole of it when the row is part of it.
    vscode.commands.registerCommand('kohVibe.fileArtifact', async (node: unknown, nodes: unknown) => {
      const slugs = selectedSlugs(node, nodes);
      if (slugs.length === 0) return;
      const projects = await readArtifactProjects(projectsFile);
      // Where the page is now, marked in the list — for one page only: several
      // may sit in as many places.
      const only = slugs.length === 1 ? artifactsTree.artifact(slugs[0] ?? '') : undefined;
      const current = only === undefined ? undefined : (projectOfArtifact(only, projects) ?? null);
      const project = await chooseProject(knownProjects(projects), current, {
        pick: async (items) => vscode.window.showQuickPick(items, { placeHolder: vscode.l10n.t('Move to which project?') }),
        askName: async () => vscode.window.showInputBox({ prompt: vscode.l10n.t('Name of the new project') }),
      });
      if (project !== undefined) await fileInto(slugs, project);
    }),
    // Into a folder of the Sessions view, beside the conversations — not a
    // project of this view: the two filings are independent.
    vscode.commands.registerCommand('kohVibe.fileArtifactInFolder', async (node: unknown, nodes: unknown) => {
      const slugs = selectedSlugs(node, nodes);
      if (slugs.length === 0) return;
      await fileInSessionsFolder(slugs.map((slug) => ({ slug, title: artifactsTree.artifact(slug)?.title ?? '' })));
    }),
    vscode.commands.registerCommand('kohVibe.renameArtifactProject', async (node: unknown) => {
      const from = projectOfNode(node);
      if (from === undefined) return;
      const to = projectName(await vscode.window.showInputBox({ prompt: vscode.l10n.t('New project name'), value: from }));
      if (to === undefined || to === from) return;
      // What the folder holds now, its pages there by their title included.
      const shown = artifactsTree.shownIn(from);
      try {
        await updateArtifactProjects(projectsFile, (s) => renameFolder(s, from, shown, to));
      } catch (err) {
        channel.appendLine(`${new Date().toISOString()} artifact projects → ${err instanceof Error ? err.message : String(err)}`);
        void vscode.window.showWarningMessage(vscode.l10n.t('Koh-Vibe: could not rename the project.'));
      }
      await render();
    }),
  );

  // The last failure written to the channel, so a fault that repeats on every
  // render is written once, not every two seconds.
  let lastFault: string | undefined;

  const show = async (): Promise<void> => {
    // The cloud views fail alone: nothing that goes wrong here may stop the
    // render of the sessions underneath. The channel says what it was.
    try {
      const now = Date.now();
      const locale = vscode.env.language;
      if (routinesView.visible) {
        void routinesFeed.refresh(false);
        const view = await routinesFeed.read();
        routinesTree.setFeed(view, now, locale);
        routinesView.description = feedDescription(view, now);
      }
      if (artifactsView.visible) {
        void artifactsFeed.refresh(false);
        const view = await artifactsFeed.read();
        artifactsTree.setProjects(await readArtifactProjects(projectsFile));
        artifactsTree.setFeed(view, now, locale);
        artifactsView.description = feedDescription(view, now);
      }
      lastFault = undefined;
    } catch (err) {
      const fault = err instanceof Error ? err.message : String(err);
      if (fault === lastFault) return;
      lastFault = fault;
      channel.appendLine(`${new Date().toISOString()} cloud views → ${fault}`);
    }
  };

  return {
    render: show,
    artifactTitle: (slug) => {
      const title = artifactsTree.artifact(slug)?.title;
      return title === undefined || title.length === 0 ? undefined : title;
    },
    // Filed whether or not the view is open: the publish happens once, and a
    // view opened later must find the page already in its project.
    filePublished: async (published) => {
      await fileNewArtifacts(projectsFile, published, homedir(), (slug, err) => {
        channel.appendLine(
          `${new Date().toISOString()} artifact projects → ${slug}: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    },
  };
}
