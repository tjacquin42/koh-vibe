import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';

// Every path the activation touches is redirected into a throwaway sandbox
// before anything runs: `homedir()` (checkHooksInstalled reads
// ~/.claude/settings.json directly, bypassing CLAUDE_CONFIG_DIR — see
// paths.ts) and the three env vars the rest of the code honours
// (paths.ts: kohVibeHome, legacyHome, claudeHome). Without this, activating
// the extension in a test would read Thomas's real ~/.claude.
const { homeRef } = vi.hoisted(() => ({ homeRef: { current: '' } }));
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return { ...actual, homedir: () => homeRef.current };
});

// render() unconditionally calls refreshFromApi(home, false) with no way to
// inject a fake UsageDeps from here — unlike test/usage.test.ts, which calls
// refreshFromApi directly. Replacing the keychain read is the only way to
// keep activate() from ever reaching the real keychain or network — see
// test/oauth.test.ts for the same call, exercised directly.
vi.mock('../src/usage/oauth', () => ({
  readAccessToken: async (): Promise<string | undefined> => undefined,
  fetchUsage: async (): Promise<unknown> => undefined,
}));

import { activate } from '../src/extension';
import { forgetAttempts } from '../src/usage/reader';
import { registeredCommands, statusBarItems, treeViews, webviewViewProviders } from './stubs/vscode';

type Manifest = { contributes: { commands: Array<{ command: string }> } };
const manifest = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8')) as Manifest;

let root: string;
let subscriptions: Array<{ dispose?: () => void }>;

function fakeContext(): vscode.ExtensionContext {
  subscriptions = [];
  return {
    subscriptions,
    extensionPath: root,
    // `undefined` is an explicitly handled case (extension.ts: `stateDb =
    // context.storageUri === undefined ? undefined : …`), and the simpler of
    // the two to set up: nothing then reads the editor's own memento.
    storageUri: undefined,
    globalStorageUri: vscode.Uri.file(join(root, 'global-storage', 'state.vscdb')),
  } as unknown as vscode.ExtensionContext;
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'koh-ext-'));
  homeRef.current = join(root, 'real-home');
  process.env['KOH_VIBE_HOME'] = join(root, 'koh-vibe-home');
  process.env['KOH_VIBE_LEGACY_HOME'] = join(root, 'koh-vibe-legacy');
  process.env['CLAUDE_CONFIG_DIR'] = join(root, 'claude-home');
});

afterEach(() => {
  // Every interval, fs.watch and FocusBroker/SpoolWatcher timer activate()
  // started is registered here — the same disposal `deactivate()` leaves to
  // VSCode itself. Without it, a ticker from one test would still be running,
  // against a now-deleted sandbox, while the next test's assertions run.
  for (const sub of subscriptions) sub.dispose?.();
  registeredCommands.length = 0;
  treeViews.length = 0;
  webviewViewProviders.length = 0;
  statusBarItems.length = 0;
  forgetAttempts();
  delete process.env['KOH_VIBE_HOME'];
  delete process.env['KOH_VIBE_LEGACY_HOME'];
  delete process.env['CLAUDE_CONFIG_DIR'];
  rmSync(root, { recursive: true, force: true });
});

describe('activate', () => {
  it(
    'registers every command the manifest declares, creates the views, and renders once without throwing',
    async () => {
      await expect(activate(fakeContext())).resolves.toBeUndefined();

      const registered = new Set(registeredCommands.map((c) => c.command));
      const declared = manifest.contributes.commands.map((c) => c.command);
      // Both directions: a command declared in package.json but never
      // registered is a button that does nothing; one registered but never
      // declared can never be reached from the UI at all.
      for (const command of declared) expect(registered.has(command)).toBe(true);
      expect(registered.size).toBe(declared.length);

      expect(treeViews.map((v) => v.viewId).sort()).toEqual(
        ['kohVibe.sessions', 'kohVibe.processes', 'kohVibe.settings', 'kohVibe.closed'].sort(),
      );
      expect(webviewViewProviders.map((p) => p.viewId)).toEqual(['kohVibe.usage']);

      // Set once in the StatusSummary constructor, regardless of what render()
      // goes on to display.
      expect(statusBarItems).toHaveLength(1);
      expect(statusBarItems[0]?.command).toBe('kohVibe.sessions.focus');
      expect(statusBarItems[0]?.name).toBe('Koh-Vibe');
    },
    10_000,
  );

  it(
    'hides the status bar summary on an empty dashboard, rather than showing a count of zero',
    async () => {
      await activate(fakeContext());
      expect(statusBarItems[0]?.visible).toBe(false);
    },
    10_000,
  );

  it(
    'leaves a guard clause rather than throwing, for a command invoked with no matching row',
    async () => {
      await activate(fakeContext());
      const byId = (command: string): ((...args: unknown[]) => unknown) => {
        const found = registeredCommands.find((c) => c.command === command);
        if (found === undefined) throw new Error(`${command} was not registered`);
        return found.callback;
      };

      // `undefined` is not a tree node of any kind: `sessionIdOfNode` and
      // `groupIdOfNode` both read it as "no id", which every one of these
      // handlers treats as nothing to act on.
      await expect(byId('kohVibe.copySessionId')(undefined)).resolves.toBeUndefined();
      await expect(byId('kohVibe.sleepSession')(undefined)).resolves.toBeUndefined();
      await expect(byId('kohVibe.closeSession')(undefined)).resolves.toBeUndefined();
      await expect(byId('kohVibe.forgetSession')(undefined)).resolves.toBeUndefined();
      await expect(byId('kohVibe.deleteGroup')(undefined)).resolves.toBeUndefined();
      await expect(byId('kohVibe.renameGroup')(undefined)).resolves.toBeUndefined();
      // Not one of the two real toggles: `SETTING_TOGGLES.find` finds
      // nothing, and the command is a no-op rather than a thrown error.
      expect(byId('kohVibe.toggleSetting')('not-a-real-toggle')).toBeUndefined();
      // A no-op registered so a title button always has a command to bind
      // to; package.json keeps it disabled.
      expect(byId('kohVibe.rescanning')()).toBeUndefined();
    },
    10_000,
  );

  it(
    'picks the legacy state back up when the new root does not exist yet',
    async () => {
      const legacy = process.env['KOH_VIBE_LEGACY_HOME'];
      if (legacy === undefined) throw new Error('KOH_VIBE_LEGACY_HOME was not set');
      mkdirSync(join(legacy, 'sessions'), { recursive: true });
      writeFileSync(join(legacy, 'sessions', 'old.json'), '{}', 'utf8');

      await activate(fakeContext());

      // migrateLegacyHome renames the folder itself: once activation has
      // run, the legacy root is gone and the new one carries what it held.
      const home = process.env['KOH_VIBE_HOME'];
      if (home === undefined) throw new Error('KOH_VIBE_HOME was not set');
      expect(existsSync(legacy)).toBe(false);
      expect(existsSync(join(home, 'sessions', 'old.json'))).toBe(true);
    },
    10_000,
  );
});
