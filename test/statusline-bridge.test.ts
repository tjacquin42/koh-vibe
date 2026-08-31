import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const BRIDGE = join(process.cwd(), 'bin/koh-vibe-statusline');
const PAYLOAD = '{"rate_limits":{"five_hour":{"used_percentage":78,"resets_at":1786297800}}}';

let home: string;

const b64 = (s: string): string => Buffer.from(s, 'utf8').toString('base64');

function run(stdin: string, arg?: string): string {
  return execFileSync(BRIDGE, arg === undefined ? [] : [arg], {
    input: stdin,
    env: { ...process.env, KOH_VIBE_HOME: home },
    encoding: 'utf8',
  });
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'koh-sl-'));
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe('koh-vibe-statusline', () => {
  it('drops the snapshot as is, without interpreting it', () => {
    expect(run(PAYLOAD)).toBe('');
    expect(readFileSync(join(home, 'status.json'), 'utf8')).toBe(PAYLOAD);
  });

  it('writes nothing of its own on stdout — that stream belongs to the status line', () => {
    expect(run(PAYLOAD)).toBe('');
  });

  it('lets the delegate output through, and hands it the SAME input', () => {
    const out = run(PAYLOAD, b64(`/usr/bin/head -c 12`));
    expect(out).toBe(PAYLOAD.slice(0, 12));
    // Et l instantané a bien été capté au passage.
    expect(readFileSync(join(home, 'status.json'), 'utf8')).toBe(PAYLOAD);
  });

  it('survives a delegate that fails, returning nothing noisy', () => {
    expect(run(PAYLOAD, b64('/bin/sh -c "exit 3"'))).toBe('');
    expect(existsSync(join(home, 'status.json'))).toBe(true);
  });

  it('accepts a delegate whose command holds quotes and apostrophes', () => {
    const script = join(home, 'delegue.sh');
    writeFileSync(script, '#!/bin/sh\necho "il a dit: \'salut\'"\n', 'utf8');
    chmodSync(script, 0o755);
    expect(run(PAYLOAD, b64(`'${script}'`)).trim()).toBe("il a dit: 'salut'");
  });

  it('leaves no temporary file behind', () => {
    run(PAYLOAD);
    const { readdirSync } = require('node:fs') as typeof import('node:fs');
    expect(readdirSync(home).filter((f) => f.startsWith('.tmp'))).toEqual([]);
  });

  it('creates nothing when the state folder does not exist', () => {
    rmSync(home, { recursive: true, force: true });
    expect(run(PAYLOAD)).toBe('');
    expect(existsSync(join(home, 'status.json'))).toBe(false);
    home = mkdtempSync(join(tmpdir(), 'koh-sl-'));
  });

  it('does not overwrite a valid snapshot with emptiness', () => {
    run(PAYLOAD);
    run('');
    expect(readFileSync(join(home, 'status.json'), 'utf8')).toBe(PAYLOAD);
  });
});
