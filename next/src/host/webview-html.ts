/**
 * The HTML each web view starts from.
 *
 * Two sources, one shape. In development the page pulls its modules from the
 * Vite server, so an edit to the view shows up in place, without reloading
 * the editor window. Built, it loads the bundle shipped in `dist/view`.
 *
 * Fonts are bundled either way: the web view's content security policy
 * cannot reach Google Fonts, and should not — the extension must render the
 * same offline.
 */
import { randomBytes } from 'node:crypto';

export interface HtmlSource {
  /** `webview.cspSource`: the origin VSCode serves local resources from. */
  cspSource: string;
  /** A fresh random value per render, required on every inline or module script. */
  nonce: string;
}

export interface DevSource extends HtmlSource {
  kind: 'dev';
  /** The Vite server, e.g. `http://localhost:5199`. No trailing slash. */
  devUrl: string;
}

export interface BuiltSource extends HtmlSource {
  kind: 'built';
  /** `asWebviewUri` of `dist/view/assets/main.js` and `…/main.css`. */
  scriptUri: string;
  styleUri: string;
}

const BODY = '<body><div id="root"></div></body></html>';

function head(csp: string, extra: string): string {
  return (
    '<!doctype html><html><head><meta charset="utf-8">' +
    `<meta http-equiv="Content-Security-Policy" content="${csp}">` +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    extra +
    '</head>'
  );
}

export function devHtml(s: DevSource): string {
  const ws = s.devUrl.replace(/^http/, 'ws');
  const csp = [
    "default-src 'none'",
    `img-src ${s.cspSource} ${s.devUrl} data:`,
    // Vite injects the CSS as <style> elements while it serves the page.
    `style-src ${s.cspSource} ${s.devUrl} 'unsafe-inline'`,
    `font-src ${s.cspSource} ${s.devUrl}`,
    `script-src 'nonce-${s.nonce}' ${s.devUrl}`,
    `connect-src ${s.devUrl} ${ws}`,
  ].join('; ');
  // The React Fast Refresh preamble that Vite would normally inject into its
  // own index.html: this page is not served by Vite, so it has to carry it.
  const preamble =
    `<script type="module" nonce="${s.nonce}">` +
    `import RefreshRuntime from "${s.devUrl}/@react-refresh";` +
    'RefreshRuntime.injectIntoGlobalHook(window);' +
    'window.$RefreshReg$ = () => {};' +
    'window.$RefreshSig$ = () => (type) => type;' +
    'window.__vite_plugin_react_preamble_installed__ = true;' +
    '</script>' +
    `<script type="module" nonce="${s.nonce}" src="${s.devUrl}/@vite/client"></script>` +
    `<script type="module" nonce="${s.nonce}" src="${s.devUrl}/src/main.tsx"></script>`;
  return head(csp, preamble) + BODY;
}

export function builtHtml(s: BuiltSource): string {
  const csp = [
    "default-src 'none'",
    `img-src ${s.cspSource} data:`,
    `style-src ${s.cspSource}`,
    `font-src ${s.cspSource}`,
    `script-src 'nonce-${s.nonce}'`,
  ].join('; ');
  const tags =
    `<link rel="stylesheet" href="${s.styleUri}">` +
    `<script type="module" nonce="${s.nonce}" src="${s.scriptUri}"></script>`;
  return head(csp, tags) + BODY;
}

/** 128 random bits, hex-encoded: a nonce must not be guessable. */
export function makeNonce(): string {
  return randomBytes(16).toString('hex');
}
