import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ViewMessage } from '../../src/shared/protocol';
import { createBridge } from '../src/bridge';

type Listener = (event: { data: unknown }) => void;

/** A window that remembers its listeners and its storage, as far as the bridge asks. */
function fakeWindow(storage: 'ok' | 'blocked' = 'ok') {
  const listeners = new Set<Listener>();
  const store = new Map<string, string>();
  const win = {
    addEventListener: (_type: string, l: Listener) => void listeners.add(l),
    removeEventListener: (_type: string, l: Listener) => void listeners.delete(l),
    localStorage: {
      getItem: (k: string) => {
        if (storage === 'blocked') throw new Error('blocked');
        return store.get(k) ?? null;
      },
      setItem: (k: string, v: string) => {
        if (storage === 'blocked') throw new Error('blocked');
        store.set(k, v);
      },
    },
  };
  return { win, listeners, store, send: (data: unknown) => listeners.forEach((l) => l({ data })) };
}

const ping: ViewMessage = { type: 'ready' };

afterEach(() => vi.unstubAllGlobals());

describe('the view’s line to the editor', () => {
  it('in the editor: posts through VSCode, and keeps its memory in the view’s own state', () => {
    const w = fakeWindow();
    const posted: unknown[] = [];
    let state: unknown;
    vi.stubGlobal('window', w.win);
    vi.stubGlobal('acquireVsCodeApi', () => ({ postMessage: (m: unknown) => posted.push(m), getState: () => state, setState: (s: unknown) => (state = s) }));
    const bridge = createBridge();
    expect(bridge.inEditor).toBe(true);
    bridge.post(ping);
    expect(posted).toEqual([ping]);
    bridge.save({ folded: ['a'] });
    expect(bridge.load()).toEqual({ folded: ['a'] });
    // The browser’s storage is not the editor’s business.
    expect(w.store.size).toBe(0);
  });

  it('in a browser: posts nowhere, and keeps its memory in localStorage', () => {
    const w = fakeWindow();
    vi.stubGlobal('window', w.win);
    const bridge = createBridge();
    expect(bridge.inEditor).toBe(false);
    expect(() => bridge.post(ping)).not.toThrow();
    expect(bridge.load()).toBeUndefined();
    bridge.save({ n: 1 });
    expect(w.store.get('koh-vibe-next.ui')).toBe('{"n":1}');
    expect(bridge.load()).toEqual({ n: 1 });
  });

  it('in a browser: forgets quietly when the storage is blocked or holds something unreadable', () => {
    const blocked = fakeWindow('blocked');
    vi.stubGlobal('window', blocked.win);
    const bridge = createBridge();
    expect(() => bridge.save({ n: 1 })).not.toThrow();
    expect(bridge.load()).toBeUndefined();
    const garbled = fakeWindow();
    garbled.store.set('koh-vibe-next.ui', '{oops');
    vi.stubGlobal('window', garbled.win);
    expect(createBridge().load()).toBeUndefined();
  });

  it('hands on what the host says, drops what it does not recognise, and stops when unsubscribed', () => {
    const w = fakeWindow();
    vi.stubGlobal('window', w.win);
    const seen: unknown[] = [];
    const off = createBridge().listen((m) => seen.push(m));
    w.send({ type: 'steady' });
    w.send({ type: 'nonsense' });
    w.send('a string');
    w.send({ type: 'showSheet', sessionId: 's1' });
    expect(seen).toEqual([{ type: 'steady' }, { type: 'showSheet', sessionId: 's1' }]);
    off();
    expect(w.listeners.size).toBe(0);
    w.send({ type: 'steady' });
    expect(seen).toHaveLength(2);
  });
});
