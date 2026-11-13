import { describe, expect, it } from 'vitest';
import type { Session } from '../../src/events/types';
import { openSession, V1_FOCUS_COMMAND, type OpenSessionDeps } from '../src/host/open-session';

const session: Session = { id: 'a', cwd: '/w', project: 'p', origin: 'vscode', status: 'idle', toolCount: 0, lastEventAt: 0 };

function deps(over: Partial<OpenSessionDeps> = {}) {
  const log: string[] = [];
  const d: OpenSessionDeps = {
    read: async (id) => (id === 'a' ? session : undefined),
    hasCommand: async (cmd) => cmd === V1_FOCUS_COMMAND,
    run: async (cmd, arg) => {
      log.push(`${cmd}:${arg.id}`);
    },
    fallback: (id) => log.push(`cockpit:${id}`),
    ...over,
  };
  return { d, log };
}

describe('openSession', () => {
  it('hands the stored session to V1', async () => {
    const { d, log } = deps();
    expect(await openSession('a', d)).toBe('v1');
    expect(log).toEqual(['kohVibe.focusSession:a']);
  });

  it('falls back to the cockpit without V1, without the session, or when V1 throws', async () => {
    for (const over of [
      { hasCommand: async () => false },
      { read: async () => undefined },
      { run: async () => Promise.reject(new Error('boom')) },
    ] satisfies Partial<OpenSessionDeps>[]) {
      const { d, log } = deps(over);
      expect(await openSession('a', d)).toBe('fallback');
      expect(log.at(-1)).toBe('cockpit:a');
    }
  });
});
