import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { translator } from '../src/i18n';
import { search } from '../src/search';
import { Results } from '../src/views/Results';
import { testCtx } from './ctx';

const t = translator('en');

describe('what the search found, in place of the tabs', () => {
  it('says nothing matched, with the words typed, trimmed', () => {
    const ctx = testCtx();
    const results = search(ctx.snapshot, 'zzzz-nothing');
    if (results === undefined) throw new Error('a query was typed');
    const out = renderToStaticMarkup(<Results ctx={ctx} results={results} query="  zzzz-nothing " />);
    expect(out).toContain(t('search.none', { q: 'zzzz-nothing' }));
    expect(out).not.toContain(t('search.sessions'));
  });

  it('groups what matched by kind, each under its heading and with its count, and leaves out the empty kinds', () => {
    const ctx = testCtx();
    const snap = { ...ctx.snapshot, artifacts: { at: 0, items: [{ slug: 'a9', title: 'Zebra plan', pinned: false }] } };
    const all = testCtx({ snapshot: snap });
    const results = search(snap, 'zebra');
    if (results === undefined) throw new Error('a query was typed');
    expect(results.sessions).toHaveLength(0);
    const out = renderToStaticMarkup(<Results ctx={all} results={results} query="zebra" />);
    expect(out).toContain(t('search.artifacts'));
    expect(out).toContain('Zebra plan');
    expect(out).not.toContain(t('search.sessions'));
    expect(out).not.toContain(t('search.closed'));
  });

  it('shows conversations and closed ones as their own rows', () => {
    const ctx = testCtx();
    const first = ctx.snapshot.sessions[0];
    const closed = ctx.snapshot.closed[0];
    if (first === undefined || closed === undefined) throw new Error('sample has both');
    const out = renderToStaticMarkup(<Results ctx={ctx} results={{ sessions: [first], closed: [closed], artifacts: [] }} query="x" />);
    expect(out).toContain(t('search.sessions'));
    expect(out).toContain(`data-session="${first.id}"`);
    expect(out).toContain(t('search.closed'));
  });
});
