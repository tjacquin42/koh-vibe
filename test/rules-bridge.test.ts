import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const RULES = join(process.cwd(), 'bin/koh-vibe-rules');
let home: string;

/** One prompt submitted by a conversation: what the script prints, and how it exits. */
function prompt(sessionId: string, stdin?: string): { out: string; status: number } {
  const res = spawnSync(RULES, [], {
    input: stdin ?? JSON.stringify({ session_id: sessionId, prompt: 'hello', hook_event_name: 'UserPromptSubmit' }),
    env: { ...process.env, KOH_VIBE_HOME: home },
    encoding: 'utf8',
  });
  if (res.error !== undefined && (res.error as NodeJS.ErrnoException).code !== 'EPIPE') throw res.error;
  return { out: res.stdout, status: res.status ?? -1 };
}

const fileInto = (assignments: Record<string, string>): void => {
  writeFileSync(join(home, 'groups.json'), JSON.stringify({ version: 1, groups: [], assignments }));
};
const rules = (groupId: string, text: string): void => {
  mkdirSync(join(home, 'rules'), { recursive: true });
  writeFileSync(join(home, 'rules', `${groupId}.md`), text);
};

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'koh-rules-'));
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe('koh-vibe-rules', () => {
  it('adds the rules of the folder a conversation is filed in, once, then again only when they change', () => {
    fileInto({ s1: 'g-video' });
    rules('g-video', '---\nfolder: VIDEO\n---\nUse create-pixel-art-video-koh-style.\n');
    const first = prompt('s1');
    expect(first.status).toBe(0);
    expect(first.out).toContain('Use create-pixel-art-video-koh-style.');
    expect(first.out).toContain('folder: VIDEO');
    expect(prompt('s1').out).toBe('');
    rules('g-video', '---\nfolder: VIDEO\n---\nUse create-pixel-art-video-koh-style.\nAlways vertical.\n');
    expect(prompt('s1').out).toContain('Always vertical.');
    // Each conversation gets them for itself.
    fileInto({ s1: 'g-video', s2: 'g-video' });
    expect(prompt('s2').out).toContain('Always vertical.');
  });

  it('gives a conversation moved to another folder that folder’s rules', () => {
    fileInto({ s1: 'g-video' });
    rules('g-video', 'Video rules.\n');
    rules('g-pro', 'Pro rules.\n');
    expect(prompt('s1').out).toContain('Video rules.');
    fileInto({ s1: 'g-pro' });
    expect(prompt('s1').out).toContain('Pro rules.');
  });

  it('says once that the rules no longer apply, when the conversation leaves the folder or they are gone', () => {
    fileInto({ s1: 'g-video' });
    rules('g-video', 'Video rules.\n');
    prompt('s1');
    fileInto({});
    const left = prompt('s1');
    expect(left.out).toContain('no longer apply');
    expect(prompt('s1').out).toBe('');
  });

  it('prints nothing for a conversation in no folder, a folder with no rules, or empty rules', () => {
    expect(prompt('s1').out).toBe('');
    fileInto({ s1: 'g-none', s2: 'g-empty' });
    rules('g-empty', '');
    expect(prompt('s1').out).toBe('');
    expect(prompt('s2').out).toBe('');
  });

  it('never fails the prompt, whatever it is handed', () => {
    fileInto({ s1: 'g-video' });
    rules('g-video', 'Video rules.\n');
    for (const stdin of ['', 'not json', '{"session_id":"../s1"}', '{"session_id":"a.b"}', '{}']) {
      const res = prompt('', stdin);
      expect(res.status).toBe(0);
      expect(res.out).toBe('');
    }
  });
});

describe('koh-vibe-rules, on a file with nothing but its header', () => {
  it('prints nothing: a folder whose rules are not written yet has none', () => {
    fileInto({ s1: 'g-video' });
    rules('g-video', '---\nfolder: VIDEO\n---\n\n');
    expect(prompt('s1').out).toBe('');
  });
});
