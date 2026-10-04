import { describe, expect, it } from 'vitest';
import { StatusSummary } from '../src/ui/statusbar';
import { statusBarItems } from './stubs/vscode';
import type { Session } from '../src/events/types';

const session = (id: string, status: Session['status']): Session => ({
  id,
  cwd: '/x',
  project: 'x',
  origin: 'vscode',
  status,
  toolCount: 0,
  lastEventAt: 0,
});

const shown = (...sessions: Session[]): { text?: string; tooltip?: string; visible: boolean; warned: boolean } => {
  const summary = new StatusSummary();
  const item = statusBarItems[statusBarItems.length - 1];
  if (item === undefined) throw new Error('no status bar item was created');
  summary.update(new Map(sessions.map((s) => [s.id, s])));
  return { text: item.text, tooltip: item.tooltip, visible: item.visible, warned: item.backgroundColor !== undefined };
};

describe('StatusSummary', () => {
  it('hides itself when nothing runs', () => {
    expect(shown().visible).toBe(false);
  });

  it('counts what waits, what runs and what finished, in that order', () => {
    const out = shown(session('a', 'waiting'), session('b', 'running'), session('c', 'running'), session('d', 'done_unseen'));
    expect(out.text).toBe('$(question) 1 · $(circle-filled) 2 · $(check) 1');
    expect(out.tooltip).toBe('Koh-Vibe — 4 sessions');
    expect(out.visible).toBe(true);
  });

  it('shows the plain count when every session is idle, and no warning colour', () => {
    const out = shown(session('a', 'idle'));
    expect(out.text).toBe('$(circle-outline) 1');
    expect(out.tooltip).toBe('Koh-Vibe — 1 session');
    expect(out.warned).toBe(false);
  });

  it('turns to the warning colour only while a session waits for the user', () => {
    // Same reason as the dot in the tree: a session that waits is not a
    // failure, but it is the one thing worth catching the eye for.
    expect(shown(session('a', 'waiting')).warned).toBe(true);
    expect(shown(session('a', 'running')).warned).toBe(false);
  });
});
