import { describe, expect, it } from 'vitest';
import {
  installStatusLine,
  uninstallStatusLine,
  wrappedStatusLine,
} from '../src/hooks/installer';

const BRIDGE = '/Users/dev/.koh-vibe/bin/koh-vibe-statusline';
const FOREIGN = '/Users/dev/.vibe-island/bin/vibe-island-statusline';

const commandOf = (settings: unknown): string | undefined =>
  (settings as { statusLine?: { command?: string } }).statusLine?.command;

describe('installStatusLine', () => {
  it('takes the spot when it is free', () => {
    const after = installStatusLine({}, BRIDGE);
    expect(commandOf(after)).toContain(BRIDGE);
    expect(wrappedStatusLine(after)).toBe('');
  });

  it('wraps the command that occupied the spot, without losing it', () => {
    const after = installStatusLine({ statusLine: { type: 'command', command: FOREIGN } }, BRIDGE);
    expect(wrappedStatusLine(after)).toBe(FOREIGN);
  });

  it('encodes the previous command: neither an apostrophe nor a quote gets through unescaped', () => {
    const tordue = `/bin/sh -c 'echo "salut" && jq -r .x'`;
    const after = installStatusLine({ statusLine: { type: 'command', command: tordue } }, BRIDGE);
    const command = commandOf(after) ?? '';
    expect(command).not.toContain('echo');
    expect(wrappedStatusLine(after)).toBe(tordue);
  });

  it('does not nest when reinstalling over itself', () => {
    const once = installStatusLine({ statusLine: { type: 'command', command: FOREIGN } }, BRIDGE);
    const twice = installStatusLine(once, BRIDGE);
    expect(wrappedStatusLine(twice)).toBe(FOREIGN);
    expect(commandOf(twice)).toBe(commandOf(once));
  });

  it('keeps a fallback that runs the previous command if our bridge has disappeared', () => {
    const after = installStatusLine({ statusLine: { type: 'command', command: FOREIGN } }, BRIDGE);
    const command = commandOf(after) ?? '';
    // Two execs: ours conditional, the fallback's unconditional.
    expect(command).toContain('[ -x "');
    expect(command.match(/exec/g) ?? []).toHaveLength(2);
  });

  it('touches nothing else in the file', () => {
    const after = installStatusLine({ model: 'opus', hooks: { Stop: [] } }, BRIDGE);
    expect((after as { model?: string }).model).toBe('opus');
    expect((after as { hooks?: unknown }).hooks).toEqual({ Stop: [] });
  });
});

describe('wrappedStatusLine', () => {
  it('does not recognize a foreign command that merely mentions our bridge', () => {
    // The trap that substring recognition would let through: this command
    // would be classified as ours, then removed on uninstall.
    const settings = { statusLine: { type: 'command', command: `/bin/sh -c 'autre && ${BRIDGE}'` } };
    expect(wrappedStatusLine(settings)).toBeUndefined();
  });

  it('does not recognize a bridge whose name ends differently', () => {
    const settings = installStatusLine({}, '/Users/dev/bin/pas-notre-statusline');
    expect(wrappedStatusLine(settings)).toBeUndefined();
  });

  it('ignores a missing statusline or one of an unexpected shape', () => {
    expect(wrappedStatusLine({})).toBeUndefined();
    expect(wrappedStatusLine({ statusLine: 'une chaîne' })).toBeUndefined();
    expect(wrappedStatusLine({ statusLine: { type: 'command' } })).toBeUndefined();
    expect(wrappedStatusLine(null)).toBeUndefined();
  });
});

describe('uninstallStatusLine', () => {
  it('gives the spot back to whoever occupied it', () => {
    const after = uninstallStatusLine(installStatusLine({ statusLine: { type: 'command', command: FOREIGN } }, BRIDGE));
    expect(commandOf(after)).toBe(FOREIGN);
  });

  it('removes the key when we were not wrapping anything', () => {
    const after = uninstallStatusLine(installStatusLine({}, BRIDGE));
    expect(after).not.toHaveProperty('statusLine');
  });

  it('does not touch a statusline that is not ours', () => {
    const settings = { statusLine: { type: 'command', command: FOREIGN } };
    expect(uninstallStatusLine(settings)).toEqual(settings);
  });

  it('does the full round trip without changing anything', () => {
    const before = { statusLine: { type: 'command', command: FOREIGN }, model: 'opus' };
    expect(uninstallStatusLine(installStatusLine(before, BRIDGE))).toEqual(before);
  });
});
