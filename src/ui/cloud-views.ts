import * as vscode from 'vscode';
import { listArtifacts } from '../artifacts/api';
import { artifactUrl, isArtifact, type Artifact } from '../artifacts/model';
import { readCredentials, type CloudDeps } from '../cloud/account';
import { Feed } from '../cloud/feed';
import { logged } from '../cloud/log';
import { send } from '../cloud/request';
import { artifactsFile, routinesFile } from '../paths';
import { launchRoutine, pauseRoutine, type RoutineCalls, type RoutineUi } from '../routines/actions';
import { listRoutines, runRoutine, setRoutineEnabled } from '../routines/api';
import { isRoutine, routineUrl, type Routine } from '../routines/model';
import { ArtifactsTree, artifactSlugOfNode } from './artifacts-tree';
import { feedDescription } from './feed-labels';
import { RoutinesTree, routineIdOfNode } from './routines-tree';

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
): () => Promise<void> {
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
  const artifactsTree = new ArtifactsTree();
  const artifactsView = vscode.window.createTreeView('kohVibe.artifacts', { treeDataProvider: artifactsTree });

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
      if (r !== undefined) await pauseRoutine(r, true, routineCalls, routineUi);
    }),
    vscode.commands.registerCommand('kohVibe.resumeRoutine', async (node: unknown) => {
      const r = routineAt(node);
      if (r !== undefined) await pauseRoutine(r, false, routineCalls, routineUi);
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
  );

  return async () => {
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
      artifactsTree.setFeed(view, now, locale);
      artifactsView.description = feedDescription(view, now);
    }
  };
}
