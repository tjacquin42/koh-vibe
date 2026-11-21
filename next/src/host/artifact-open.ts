/**
 * Where artifacts open (15/11): the browser, or the editor's integrated
 * browser, in a tab of its own.
 *
 * The integrated browser (VS Code, recent) is a real browser in an editor
 * tab, the only place inside the editor where the claude.ai page can open —
 * it refuses to show in a frame (frame-ancestors), which is all a web view or
 * the Simple Browser has. An editor without one opens the browser, and says
 * so once.
 */
import { artifactUrl } from '../../../src/artifacts/model';
import { ARTIFACT_OPENS, type ArtifactOpen } from '../shared/actions';

/** The command that opens the editor's integrated browser on a page. */
export const INTEGRATED_BROWSER = 'workbench.action.browser.open';

export interface ArtifactOpenDeps {
  /** What the editor's state holds for the choice — anything, it is read as untrusted. */
  kept(): unknown;
  /** Every command the editor knows. */
  commands(): Thenable<string[]>;
  run(command: string, arg: { url: string }): Thenable<unknown>;
  openExternal(url: string): void;
  /** Tells the user, once, that this editor has no integrated browser. */
  sayNoBrowser(): void;
}

export interface ArtifactOpener {
  /** The place chosen in the settings. */
  where(): ArtifactOpen;
  /** Whether this editor has an integrated browser — asked once, it does not come and go. */
  hasBrowser(): Promise<boolean>;
  open(slug: string): Promise<void>;
}

export function artifactOpener(deps: ArtifactOpenDeps): ArtifactOpener {
  let browser: boolean | undefined;
  let said = false;
  const where = (): ArtifactOpen => {
    const kept = deps.kept();
    // « Over the cockpit » is gone (15/11): it opened the same browser, in the editor.
    return kept === 'cockpit' ? 'editor' : (ARTIFACT_OPENS.find((w) => w === kept) ?? 'browser');
  };
  const hasBrowser = async (): Promise<boolean> => {
    browser ??= (await deps.commands()).includes(INTEGRATED_BROWSER);
    return browser;
  };
  return {
    where,
    hasBrowser,
    async open(slug) {
      const url = artifactUrl(slug);
      if (where() === 'browser') {
        deps.openExternal(url);
        return;
      }
      if (await hasBrowser()) {
        try {
          await deps.run(INTEGRATED_BROWSER, { url });
          return;
        } catch {
          // On to the browser.
        }
      } else if (!said) {
        said = true;
        deps.sayNoBrowser();
      }
      deps.openExternal(url);
    },
  };
}
