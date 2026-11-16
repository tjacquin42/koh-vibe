import { describe, expect, it } from 'vitest';
import { artifactOpener, INTEGRATED_BROWSER } from '../src/host/artifact-open';

function editor(opts: { kept?: unknown; browser?: boolean; fails?: boolean } = {}) {
  const log: string[] = [];
  let asked = 0;
  const opener = artifactOpener({
    kept: () => opts.kept,
    commands: async () => {
      asked++;
      return opts.browser === true ? ['workbench.action.files.save', INTEGRATED_BROWSER] : ['workbench.action.files.save'];
    },
    run: async (command, arg) => {
      if (opts.fails === true) throw new Error('no tab');
      log.push(`${command} ${arg.url}`);
    },
    openExternal: (url) => log.push(`external ${url}`),
    sayNoBrowser: () => log.push('said'),
  });
  return { opener, log, asked: () => asked };
}

const URL = 'https://claude.ai/artifact/abc-123';

describe('where an artifact opens', () => {
  it('is the browser unless the settings say the editor', () => {
    expect(editor().opener.where()).toBe('browser');
    expect(editor({ kept: 'editor' }).opener.where()).toBe('editor');
    expect(editor({ kept: 'somewhere' }).opener.where()).toBe('browser');
    // « Over the cockpit », kept by an older version, opened the same browser in the editor.
    expect(editor({ kept: 'cockpit' }).opener.where()).toBe('editor');
  });

  it('opens the browser when that is the choice, without asking the editor anything', async () => {
    const e = editor({ kept: 'browser', browser: true });
    await e.opener.open('abc-123');
    expect(e.log).toEqual([`external ${URL}`]);
    expect(e.asked()).toBe(0);
  });

  it('opens the editor’s integrated browser when the editor has one', async () => {
    const e = editor({ kept: 'editor', browser: true });
    await e.opener.open('abc-123');
    expect(e.log).toEqual([`${INTEGRATED_BROWSER} ${URL}`]);
  });

  it('falls back to the browser where the editor has none, and says so once', async () => {
    const e = editor({ kept: 'editor', browser: false });
    await e.opener.open('abc-123');
    await e.opener.open('abc-123');
    expect(e.log).toEqual(['said', `external ${URL}`, `external ${URL}`]);
    // Whether the editor has one does not change: asked once.
    expect(e.asked()).toBe(1);
    expect(await e.opener.hasBrowser()).toBe(false);
  });

  it('falls back to the browser when the integrated one would not open — which is not « has none »', async () => {
    const e = editor({ kept: 'editor', browser: true, fails: true });
    await e.opener.open('abc-123');
    expect(e.log).toEqual([`external ${URL}`]);
  });
});
