import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DICTIONARIES, translator } from '../view/src/i18n';

const en = DICTIONARIES['en'] ?? {};
const keys = Object.keys(en);

/** Every source file of the view, but the dictionary itself. */
function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return sources(path);
    return /\.tsx?$/.test(e.name) && e.name !== 'i18n.ts' ? [readFileSync(path, 'utf8')] : [];
  });
}

const placeholders = (text: string): string[] => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1] ?? '').sort();

describe('the view’s strings', () => {
  const others = Object.entries(DICTIONARIES).filter(([language]) => language !== 'en');

  /**
   * Said in English in every language, on purpose: the product's name, the
   * cockpit's views, and everything that names a conversation's state — the
   * counts, the board's columns, the dot's own label (14/11, 16/11).
   */
  const ENGLISH_ONLY = [
    'app.name',
    'board.done',
    'board.rest',
    'board.run',
    'board.wait',
    'cockpit.count.done',
    'cockpit.count.running',
    'cockpit.count.waiting',
    'cockpit.view.board',
    'cockpit.view.feed',
    'cockpit.view.timeline',
    'cockpit.view.wall',
    'status.done_unseen',
    'status.ended',
    'status.idle',
    'status.running',
    'status.waiting',
  ];

  it.each(others)('%s says everything English says — but what stays in English on purpose — and nothing else', (_language, dict) => {
    const said = new Set(Object.keys(dict));
    expect(keys.filter((k) => !said.has(k)).sort()).toEqual(ENGLISH_ONLY);
    expect([...said].filter((k) => !keys.includes(k))).toEqual([]);
  });

  it.each(others)('%s fills the same blanks as English, string by string', (_language, dict) => {
    const off = Object.entries(dict).filter(([k, text]) => placeholders(text).join() !== placeholders(en[k as keyof typeof en] ?? '').join());
    expect(off).toEqual([]);
  });

  it('holds no string the view no longer shows', () => {
    const code = sources(join(__dirname, '../view/src')).join('\n');
    // A key built at the call (`tab.${id}`) is used through its beginning.
    const built = new Set([...code.matchAll(/`([\w.]+\.)\$\{/g)].map((m) => m[1] ?? ''));
    const unused = keys.filter((k) => !code.includes(`'${k}'`) && ![...built].some((start) => k.startsWith(start)));
    expect(unused).toEqual([]);
  });

  it('never leaves a string empty, in any language', () => {
    for (const [language, dict] of Object.entries(DICTIONARIES)) {
      const empty = Object.entries(dict).filter(([, text]) => text.trim() === '');
      expect(empty, language).toEqual([]);
    }
  });

  it('leaves a blank it is given nothing for as it is, rather than dropping it', () => {
    expect(translator('en')('cloud.age')).toContain('{age}');
  });
});
