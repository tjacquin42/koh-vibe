import { describe, expect, it } from 'vitest';
import { OpenedHere, PENDING_OPEN_MS } from '../src/claude/opened-here';

const tab = (title: string, index = 16) => ({ title, group: 0, index });

describe('OpenedHere — recognizing the tab we just asked to be opened', () => {
  it('keeps nothing as long as nothing has been requested', () => {
    const m = new OpenedHere();
    expect(m.observe(undefined, tab('Claude Code'), 0)).toBeUndefined();
    expect(m.entries()).toEqual([]);
  });

  // The observed bug: the first event arrives ~19ms after the request,
  // while the active tab is still a file. Consuming the pending request
  // there lost the tab that arrived 8ms later.
  it('keeps the pending request open as long as no conversation is active', () => {
    const m = new OpenedHere();
    m.opening('s-nouvelle', 0);
    expect(m.observe(undefined, undefined, 19)).toBeUndefined();
    expect(m.entries()).toEqual([]);
    // The tab finally arrives.
    expect(m.observe(undefined, tab('Claude Code'), 27)).toBe('s-nouvelle');
    expect(m.entries()).toEqual([{ sessionId: 's-nouvelle', title: 'Claude Code', group: 0, index: 16 }]);
  });

  // The second one: the panel opens under « Claude Code » then takes its title.
  it('re-registers when the tab renames itself, rather than keeping a stale label', () => {
    const m = new OpenedHere();
    m.opening('s-nouvelle', 0);
    m.observe(undefined, tab('Claude Code'), 27);
    expect(m.observe(undefined, tab('Fiabilité IVECO moteur'), 640)).toBe('s-nouvelle');
    expect(m.entries()).toEqual([
      { sessionId: 's-nouvelle', title: 'Fiabilité IVECO moteur', group: 0, index: 16 },
    ]);
  });

  // The FIRST conversation seen after the request is the one we're coming
  // from: at the moment of the click, the active tab is still the previous
  // one. So it does not close the pending request — only one more
  // conversation does. The detail is checked further below, together with
  // the bug it fixes.
  it('does not close the pending request on the conversation we are coming from', () => {
    const m = new OpenedHere();
    m.opening('s-nouvelle', 0);
    expect(m.observe('s-autre', tab('#EDN monitoring', 15), 100)).toBe('s-autre');
    expect(m.observe(undefined, tab('Claude Code'), 200)).toBe('s-nouvelle');
  });

  it('lets the usual resolution answer when it names the expected conversation', () => {
    const m = new OpenedHere();
    m.opening('s-nouvelle', 0);
    expect(m.observe('s-nouvelle', tab('Fiabilité IVECO moteur'), 900)).toBe('s-nouvelle');
  });

  it('gives up past the deadline — the active tab no longer has any reason to be the one requested', () => {
    const m = new OpenedHere();
    m.opening('s-nouvelle', 0);
    expect(m.observe(undefined, tab('Autre chose'), PENDING_OPEN_MS + 1)).toBeUndefined();
    expect(m.entries()).toEqual([]);
  });

  it('keeps several conversations, each in its own place', () => {
    const m = new OpenedHere();
    m.opening('s-un', 0);
    m.observe(undefined, tab('Un', 3), 10);
    m.opening('s-deux', 100);
    m.observe(undefined, tab('Deux', 7), 110);
    expect(m.entries()).toEqual([
      { sessionId: 's-un', title: 'Un', group: 0, index: 3 },
      { sessionId: 's-deux', title: 'Deux', group: 0, index: 7 },
    ]);
  });
});

// The remaining bug: at the moment of the request, the active tab is still
// the previous one — often ANOTHER conversation. The "moved on to something
// else" rule was firing on it and dropping the pending request before the
// requested panel had even appeared.
describe('OpenedHere — the conversation left behind does not count as a change of mind', () => {
  it('keeps the pending request when the still-active tab is the one we came from', () => {
    const m = new OpenedHere();
    m.opening('s-nouvelle', 0);
    // First event: we are still on the previous conversation.
    expect(m.observe('s-precedente', tab('#EDN monitoring', 15), 20)).toBe('s-precedente');
    // The requested panel finally arrives, and nothing can name it yet.
    expect(m.observe(undefined, tab('Claude Code'), 30)).toBe('s-nouvelle');
    expect(m.entries()).toEqual([{ sessionId: 's-nouvelle', title: 'Claude Code', group: 0, index: 16 }]);
  });

  it('going back to the conversation left behind still does not close the pending request', () => {
    const m = new OpenedHere();
    m.opening('s-nouvelle', 0);
    m.observe('s-precedente', tab('#EDN monitoring', 15), 20);
    expect(m.observe('s-precedente', tab('#EDN monitoring', 15), 40)).toBe('s-precedente');
    expect(m.observe(undefined, tab('Claude Code'), 50)).toBe('s-nouvelle');
  });

  it('but a THIRD conversation does close the pending request', () => {
    const m = new OpenedHere();
    m.opening('s-nouvelle', 0);
    m.observe('s-precedente', tab('#EDN monitoring', 15), 20);
    expect(m.observe('s-tierce', tab('Autre chose', 9), 30)).toBe('s-tierce');
    expect(m.observe(undefined, tab('Claude Code'), 40)).toBeUndefined();
    expect(m.entries()).toEqual([]);
  });
});
