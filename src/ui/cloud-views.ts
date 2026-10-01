import * as vscode from 'vscode';
import { readCredentials, type CloudDeps } from '../cloud/account';
import { Feed } from '../cloud/feed';
import { logged } from '../cloud/log';
import { send } from '../cloud/request';
import { routinesFile } from '../paths';
import { listRoutines } from '../routines/api';
import { isRoutine, routineUrl, type Routine } from '../routines/model';
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

  const open = (url: string): void => {
    void vscode.env.openExternal(vscode.Uri.parse(url));
  };
  const copy = async (url: string): Promise<void> => {
    await vscode.env.clipboard.writeText(url);
    vscode.window.setStatusBarMessage(vscode.l10n.t('Koh-Vibe: link copied'), 3000);
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
  };
}
