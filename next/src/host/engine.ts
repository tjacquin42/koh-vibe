/**
 * The switch-over (plan step 5): with V1 gone, Koh-Vibe 2 runs V1's engine
 * itself — the spool drained, the sessions written, the sounds, the hooks
 * and the skill kept up to date, every `kohVibe.*` command the views call —
 * without its old tree views (V1 ui/view-host.ts).
 *
 * Never both: two engines would drain the same spool, each taking events
 * from the other. While V1 is installed, it alone runs it, and the views
 * keep asking it through its commands as before.
 *
 * What the engine reads beside its code — the hook bridges, the skill, the
 * two sounds, the hooks installer — sits in engine/ (scripts/engine-assets.mjs):
 * the engine is given that folder as the extension's own.
 */
import { join } from 'node:path';
import * as vscode from 'vscode';
import { activate as runEngine } from '../../../src/extension';
import { noViews } from '../../../src/ui/view-host';

export const V1_ID = 'tjacquin42.koh-vibe';

/** V1, installed as an extension of its own — not this one, once 2.0 takes its id. */
export function v1Installed(context: vscode.ExtensionContext): boolean {
  const v1 = vscode.extensions.getExtension(V1_ID);
  return v1 !== undefined && v1.extensionUri.toString() !== context.extensionUri.toString();
}

/** The context the engine sees: this extension's, with engine/ as its folder. */
export function engineContext(context: vscode.ExtensionContext): vscode.ExtensionContext {
  const folder = join(context.extensionPath, 'engine');
  return new Proxy(context, {
    get: (target, key) => (key === 'extensionPath' ? folder : Reflect.get(target, key, target)),
  });
}

export interface EngineDeps {
  installed(context: vscode.ExtensionContext): boolean;
  run(context: vscode.ExtensionContext): Promise<void>;
}

export const realEngine: EngineDeps = {
  installed: v1Installed,
  run: (context) => runEngine(engineContext(context), noViews),
};

/** Starts the engine unless V1 runs it; says which. A failure is logged, never thrown: the views still show what is on disk. */
export async function startEngine(context: vscode.ExtensionContext, deps: EngineDeps, log: (line: string) => void): Promise<'v1' | 'started' | 'failed'> {
  if (deps.installed(context)) {
    log('engine → V1 is installed: it runs the engine');
    return 'v1';
  }
  try {
    await deps.run(context);
    log('engine → started (V1 is not installed)');
    return 'started';
  } catch (err) {
    log(`engine → could not start: ${err instanceof Error ? err.message : String(err)}`);
    return 'failed';
  }
}
