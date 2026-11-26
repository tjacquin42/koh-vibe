/**
 * Koh-Vibe 2.0's entry point (the package at the repository's root): one
 * extension, two interfaces, never both — chosen in the settings
 * (`kohVibe.interface`), the new one by default (14/11).
 *
 * - new: Koh-Vibe 2's web views, over V1's engine without its views
 *   (extension.ts, engine.ts);
 * - classic: V1 as it was, its tree views included.
 *
 * The engine — hooks, spool, sounds, folders — is the same under both, so
 * switching loses nothing; it takes a reload, since the engine is wired at
 * start. The first start after the update says what changed and offers the
 * way back.
 */
import * as vscode from 'vscode';
import { activate as activateClassic } from '../../../src/extension';
import { activate as activateNew } from './extension';

export type Interface = 'new' | 'classic';

export function interfaceOf(config: { get(key: string): unknown }): Interface {
  return config.get('interface') === 'classic' ? 'classic' : 'new';
}

const NOTICE_KEY = 'kohVibe.interfaceNoticeShown';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const config = (): vscode.WorkspaceConfiguration => vscode.workspace.getConfiguration('kohVibe');
  const running = interfaceOf(config());
  context.subscriptions.push(
    vscode.commands.registerCommand('kohVibe.switchInterface', async () => {
      await config().update('interface', running === 'new' ? 'classic' : 'new', vscode.ConfigurationTarget.Global);
    }),
    vscode.workspace.onDidChangeConfiguration(async (e) => {
      if (!e.affectsConfiguration('kohVibe.interface') || interfaceOf(config()) === running) return;
      const reload = vscode.l10n.t('Reload');
      const answer = await vscode.window.showInformationMessage(vscode.l10n.t('Koh-Vibe: the other interface shows once the window reloads.'), reload);
      if (answer === reload) await vscode.commands.executeCommand('workbench.action.reloadWindow');
    }),
  );
  if (running === 'classic') {
    await activateClassic(context);
    return;
  }
  activateNew(context);
  // Once: the update changed what the sidebar looks like; the way back is one click.
  if (context.globalState.get(NOTICE_KEY) !== true) {
    await context.globalState.update(NOTICE_KEY, true);
    const classic = vscode.l10n.t('Back to the classic interface');
    void vscode.window
      .showInformationMessage(vscode.l10n.t('Koh-Vibe 2: a new interface, the same sessions and folders. The classic one is still a setting away.'), classic)
      .then((answer) => (answer === classic ? config().update('interface', 'classic', vscode.ConfigurationTarget.Global) : undefined));
  }
}

export function deactivate(): void {
  // Everything hangs off context.subscriptions.
}
