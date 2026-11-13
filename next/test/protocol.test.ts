import { describe, expect, it } from 'vitest';
import { isHostMessage, parseViewMessage } from '../src/shared/protocol';
import { builtHtml, devHtml, makeNonce } from '../src/host/webview-html';
import { isRelevant } from '../src/host/watch';

describe('parseViewMessage', () => {
  it('accepts the known messages', () => {
    expect(parseViewMessage({ type: 'ready' })).toEqual({ type: 'ready' });
    expect(parseViewMessage({ type: 'reload' })).toEqual({ type: 'reload' });
    expect(parseViewMessage({ type: 'openCockpit' })).toEqual({ type: 'openCockpit' });
    expect(parseViewMessage({ type: 'openCockpit', sessionId: 'abc' })).toEqual({ type: 'openCockpit', sessionId: 'abc' });
  });

  it('drops anything malformed', () => {
    for (const bad of [null, 'ready', [], {}, { type: 'rm -rf' }, { type: 'openCockpit', sessionId: 3 }, { type: 'openCockpit', sessionId: '' }]) {
      expect(parseViewMessage(bad)).toBeUndefined();
    }
  });
});

describe('isHostMessage', () => {
  it('recognises init and snapshot only', () => {
    expect(isHostMessage({ type: 'snapshot', snapshot: {} })).toBe(true);
    expect(isHostMessage({ type: 'init', snapshot: {}, context: {} })).toBe(true);
    expect(isHostMessage({ type: 'init', snapshot: {} })).toBe(false);
    expect(isHostMessage({ type: 'other' })).toBe(false);
  });
});

describe('web view HTML', () => {
  const base = { cspSource: 'vscode-resource:', nonce: 'N0NCE' };

  it('built: everything local, every script carries the nonce', () => {
    const html = builtHtml({ ...base, kind: 'built', scriptUri: 'res/main.js', styleUri: 'res/main.css' });
    expect(html).toContain("script-src 'nonce-N0NCE'");
    expect(html).toContain('<script type="module" nonce="N0NCE" src="res/main.js">');
    expect(html).not.toMatch(/https?:\/\//);
    expect(html).not.toContain('unsafe-inline');
  });

  it('dev: modules and hot reload from the Vite server', () => {
    const html = devHtml({ ...base, kind: 'dev', devUrl: 'http://localhost:5199' });
    expect(html).toContain('connect-src http://localhost:5199 ws://localhost:5199');
    expect(html).toContain('src="http://localhost:5199/@vite/client"');
    expect(html).toContain('src="http://localhost:5199/src/main.tsx"');
    expect(html).not.toContain('fonts.googleapis.com');
  });

  it('makes a fresh, unguessable nonce each time', () => {
    const a = makeNonce();
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(makeNonce()).not.toBe(a);
  });
});

describe('isRelevant', () => {
  it('ignores the spool, backups and temporary files', () => {
    expect(isRelevant('events/123.json')).toBe(false);
    expect(isRelevant('backups/x')).toBe(false);
    expect(isRelevant('sessions/.tmp-a-1-2')).toBe(false);
    expect(isRelevant('sessions/a.json')).toBe(true);
    expect(isRelevant('groups.json')).toBe(true);
    expect(isRelevant(null)).toBe(true);
  });
});
