import { describe, expect, it } from 'vitest';
import { countsOf, formatAge, formatTokens, sessionDetail, sessionTitle, toneOf } from '../view/src/format';
import { translator } from '../view/src/i18n';
import { sampleSnapshot } from '../view/src/fixture';
import type { SessionView } from '../src/shared/protocol';

const en = translator('en-US');
const fr = translator('fr');

const s = (extra: Partial<SessionView>): SessionView => ({ id: 'i', project: 'proj', status: 'idle', origin: 'vscode', toolCount: 0, lastEventAt: 0, ...extra });

describe('translator', () => {
  it('follows the language and falls back to English', () => {
    expect(fr('folder.unfiled')).toBe('Sans dossier');
    expect(translator('fr-CA')('folder.unfiled')).toBe('Sans dossier');
    expect(translator('de')('folder.unfiled')).toBe('Unfiled');
    expect(fr('app.name')).toBe('Koh-Vibe');
  });

  it('fills parameters', () => {
    expect(fr('age.min', { n: 3 })).toBe('3 min');
    expect(en('usage.resets', { d: '2 h' })).toBe('resets in 2 h');
  });
});

describe('format', () => {
  it('rounds ages and tokens', () => {
    expect(formatAge(30_000, fr)).toBe('à l’instant');
    expect(formatAge(5 * 60_000, en)).toBe('5 min');
    expect(formatAge(3 * 3_600_000, en)).toBe('3 h');
    expect(formatAge(2 * 86_400_000, fr)).toBe('2 j');
    expect(formatTokens(950)).toBe('950');
    expect(formatTokens(12_345)).toBe('12k');
    expect(formatTokens(1_400_000)).toBe('1.4M');
    expect(formatTokens(2_000_000)).toBe('2M');
    expect(formatTokens(23_600_000)).toBe('24M');
  });

  it('titles a session by its title, else project and branch', () => {
    expect(sessionTitle(s({ title: '  Fix it ' }), en)).toBe('Fix it');
    expect(sessionTitle(s({ branch: 'dev' }), en)).toBe('proj · dev');
    expect(sessionTitle(s({ project: '' }), en)).toBe('Untitled conversation');
  });

  it('details what a session is doing, the pending permission first', () => {
    expect(sessionDetail(s({ status: 'running', currentAction: { tool: 'Edit', target: 'a.ts' } }))).toBe('Edit a.ts');
    expect(sessionDetail(s({ status: 'waiting', pendingPermission: { tool: 'Bash', summary: 'ls' } }))).toBe('Bash · ls');
    expect(sessionDetail(s({ branch: 'main' }))).toBe('proj · main');
  });

  it('tones and counts open sessions only', () => {
    expect(toneOf(s({ status: 'waiting', endedAt: 1 }))).toBe('ended');
    expect(toneOf(s({ status: 'running' }))).toBe('run');
    expect(countsOf(sampleSnapshot(0))).toEqual({ waiting: 1, running: 1, done: 1 });
  });
});
