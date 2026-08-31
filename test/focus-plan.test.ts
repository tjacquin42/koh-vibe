import { describe, expect, it } from 'vitest';
import { focusPlan, focusPlanFor } from '../src/focus/plan';
import { sessionLabel } from '../src/ui/labels';
import type { Session } from '../src/events/types';

const base: Session = {
  id: 'sess-1', cwd: '/Users/dev/projet', project: 'projet', origin: 'vscode',
  status: 'running', toolCount: 0, lastEventAt: 1,
};

describe('focusPlanFor', () => {
  it('reveals the panel of a vscode session, by its id', () => {
    expect(focusPlanFor(base)).toEqual({
      kind: 'command', command: 'claude-vscode.editor.open', args: ['sess-1'],
    });
  });

  it('does the same for a desktop session', () => {
    expect(focusPlanFor({ ...base, origin: 'desktop' })).toEqual({
      kind: 'command', command: 'claude-vscode.editor.open', args: ['sess-1'],
    });
  });

  it('opens nothing for a terminal session, and says so', () => {
    const p = focusPlanFor({ ...base, origin: 'terminal' });
    expect(p.kind).toBe('explain');
    if (p.kind === 'explain') expect(p.message).toContain('terminal');
  });

  it('opens nothing for sdk and unknown either', () => {
    expect(focusPlanFor({ ...base, origin: 'sdk' }).kind).toBe('explain');
    expect(focusPlanFor({ ...base, origin: 'unknown' }).kind).toBe('explain');
  });
});

// `focusPlan` est la règle unique dont `focusPlanFor` (chemin local, une
// `Session` complète) et le broker (chemin distant, seulement sessionId /
// origin / label lus depuis un fichier de requête) sont deux appelants —
// jamais deux copies de la même décision.
describe('focusPlan — the rule both roads share', () => {
  it('reveals by id for vscode or desktop', () => {
    expect(focusPlan('sess-1', 'vscode', 'projet')).toEqual({
      kind: 'command', command: 'claude-vscode.editor.open', args: ['sess-1'],
    });
    expect(focusPlan('sess-1', 'desktop', 'projet')).toEqual({
      kind: 'command', command: 'claude-vscode.editor.open', args: ['sess-1'],
    });
  });

  it('explains for any other origin, a missing one included (a request from an earlier version)', () => {
    expect(focusPlan('sess-1', 'terminal', 'projet').kind).toBe('explain');
    expect(focusPlan('sess-1', undefined, 'projet').kind).toBe('explain');
    expect(focusPlan('sess-1', 'n-importe-quoi', 'projet').kind).toBe('explain');
  });

  it('focusPlanFor(session) delegates to focusPlan, it does not encode a rule of its own', () => {
    for (const origin of ['vscode', 'desktop', 'terminal', 'sdk', 'unknown'] as const) {
      const s = { ...base, origin };
      expect(focusPlanFor(s)).toEqual(focusPlan(s.id, s.origin, sessionLabel(s)));
    }
  });
});
