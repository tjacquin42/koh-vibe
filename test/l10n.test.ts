import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..');

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...sources(path));
    else if (name.endsWith('.ts')) out.push(path);
  }
  return out;
}

/** The literal as `vscode.l10n.t` receives it: the escapes of the source undone. */
function unescape(literal: string): string {
  return literal.replace(/\\(.)/g, (_whole, c: string) => (c === 'n' ? '\n' : c));
}

/** Every string literal passed first to `l10n.t`, across `src/`. */
function displayedStrings(): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const file of sources(join(ROOT, 'src'))) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(/l10n\.t\(\s*'((?:[^'\\]|\\.)*)'/g)) {
      const key = unescape(m[1] ?? '');
      out.set(key, [...(out.get(key) ?? []), file.slice(ROOT.length + 1)]);
    }
  }
  return out;
}

const keysOf = (file: string): Set<string> =>
  new Set(Object.keys(JSON.parse(readFileSync(join(ROOT, file), 'utf8')) as Record<string, unknown>));

/**
 * The rule of CLAUDE.md, checked rather than trusted: a string with no
 * translation falls back to English silently, so nothing but this would ever
 * say that one was forgotten.
 */
describe('the French translations', () => {
  it('cover every string the code displays', () => {
    const french = keysOf('l10n/bundle.l10n.fr.json');
    const displayed = displayedStrings();
    // A floor, so that a pattern that stopped matching cannot pass this
    // vacuously: the extension displays far more than fifty strings.
    expect(displayed.size).toBeGreaterThan(50);
    const missing = [...displayed].filter(([key]) => !french.has(key)).map(([key, files]) => `${key} (${files.join(', ')})`);
    expect(missing).toEqual([]);
  });

  it('cover every label the manifest contributes, and nothing else', () => {
    expect([...keysOf('package.nls.fr.json')].sort()).toEqual([...keysOf('package.nls.json')].sort());
  });
});
