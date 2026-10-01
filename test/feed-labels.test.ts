import { describe, expect, it } from 'vitest';
import type { FeedView } from '../src/cloud/feed';
import { feedDescription } from '../src/ui/feed-labels';

const ready = (at: number, truncated = false): FeedView<unknown> => ({
  kind: 'ready',
  snapshot: { at, items: [], truncated },
});

describe('feedDescription', () => {
  it('says nothing until there is a list: the body of the view already says why', () => {
    expect(feedDescription({ kind: 'loading' }, 0)).toBe('');
    expect(feedDescription({ kind: 'signed-out' }, 0)).toBe('');
    expect(feedDescription({ kind: 'unavailable' }, 0)).toBe('');
  });

  it('says how old the list is', () => {
    expect(feedDescription(ready(0), 30_000)).toBe('updated just now');
    expect(feedDescription(ready(0), 3 * 60_000 + 5_000)).toBe('updated 3 min ago');
  });

  it('says when the server held part of it back', () => {
    expect(feedDescription(ready(0, true), 30_000)).toBe('updated just now · incomplete list');
  });
});
