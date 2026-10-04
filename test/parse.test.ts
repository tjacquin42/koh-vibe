import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseSpoolFile } from '../src/events/parse';

const fixture = (name: string): string =>
  readFileSync(`test/fixtures/hooks/${name}.json`, 'utf8');

describe('parseSpoolFile', () => {
  it('normalizes a real PreToolUse', () => {
    const ev = parseSpoolFile(fixture('PreToolUse'));
    expect(ev?.event).toBe('PreToolUse');
    expect(ev?.sessionId).not.toBe('');
    expect(ev?.cwd).not.toBe('');
    expect(ev?.toolName).toBeDefined();
  });

  it('reads the agent behind a subagent call, and nothing for the conversation itself', () => {
    // Claude Code puts `agent_id` and `agent_type` on the calls a subagent
    // makes; a call the conversation makes carries neither. Absent means
    // "the conversation did this", so an empty or odd value must read as
    // absent too — it ends up as a map key and an icon.
    const call = (extra: string): ReturnType<typeof parseSpoolFile> =>
      parseSpoolFile(`{"event":"PreToolUse","at":1,"payload":{"session_id":"s","cwd":"/x","tool_name":"Bash"${extra}}}`);
    const byAgent = call(',"agent_id":"a75a44d961c4d575b","agent_type":"general-purpose"');
    expect(byAgent?.agentId).toBe('a75a44d961c4d575b');
    expect(byAgent?.agentType).toBe('general-purpose');
    expect(call('')?.agentId).toBeUndefined();
    expect(call('')?.agentType).toBeUndefined();
    expect(call(',"agent_id":"","agent_type":7')?.agentId).toBeUndefined();
    expect(call(',"agent_id":"","agent_type":7')?.agentType).toBeUndefined();
  });

  it('rejects invalid JSON without throwing', () => {
    expect(parseSpoolFile('{ pas du json')).toBeUndefined();
  });

  it('rejects an unknown event', () => {
    expect(parseSpoolFile('{"event":"Inconnu","at":1,"payload":{}}')).toBeUndefined();
  });

  it('rejects a payload without session_id', () => {
    expect(parseSpoolFile('{"event":"Stop","at":1,"payload":{"cwd":"/x"}}')).toBeUndefined();
  });

  it('tolerates missing entrypoint and termProgram', () => {
    const ev = parseSpoolFile('{"event":"Stop","at":5,"payload":{"session_id":"s","cwd":"/x"}}');
    expect(ev?.entrypoint).toBe('');
    expect(ev?.at).toBe(5);
  });

  it('extracts the target from tool_input', () => {
    const ev = parseSpoolFile(
      '{"event":"PreToolUse","at":1,"payload":{"session_id":"s","cwd":"/x","tool_name":"Edit","tool_input":{"file_path":"/x/a.ts"}}}',
    );
    expect(ev?.toolTarget).toBe('/x/a.ts');
  });

  it('rejects a session_id that contains a path separator', () => {
    // "a/b" produces sessions/.tmp-a/b-<pid> on the writeSession side →
    // ENOENT. A session identifier must be usable as a file name.
    expect(parseSpoolFile('{"event":"Stop","at":1,"payload":{"session_id":"a/b","cwd":"/x"}}')).toBeUndefined();
  });

  it('rejects a session_id that contains a backslash', () => {
    expect(parseSpoolFile('{"event":"Stop","at":1,"payload":{"session_id":"a\\\\b","cwd":"/x"}}')).toBeUndefined();
  });

  it('rejects a session_id of "." or ".."', () => {
    expect(parseSpoolFile('{"event":"Stop","at":1,"payload":{"session_id":".","cwd":"/x"}}')).toBeUndefined();
    expect(parseSpoolFile('{"event":"Stop","at":1,"payload":{"session_id":"..","cwd":"/x"}}')).toBeUndefined();
  });

  it('accepts an ordinary session_id', () => {
    const ev = parseSpoolFile('{"event":"Stop","at":1,"payload":{"session_id":"abc-123_XYZ","cwd":"/x"}}');
    expect(ev?.sessionId).toBe('abc-123_XYZ');
  });

  it("rejects a session_id containing a NUL byte (N3: allow-list, not a list of forbidden characters)", () => {
    // The NUL byte would slip past a validation that only reasoned by
    // blocklist ('/', '\', '.', '..'): it appears in none of these
    // exclusions, and yet remains unusable in a file name. The boundary
    // must state what IS allowed, not enumerate what isn't.
    expect(
      parseSpoolFile('{"event":"Stop","at":1,"payload":{"session_id":"a\\u0000b","cwd":"/x"}}'),
    ).toBeUndefined();
  });

  it('rejects a session_id containing a space or any exotic character', () => {
    expect(parseSpoolFile('{"event":"Stop","at":1,"payload":{"session_id":"a b","cwd":"/x"}}')).toBeUndefined();
    expect(parseSpoolFile('{"event":"Stop","at":1,"payload":{"session_id":"a✨b","cwd":"/x"}}')).toBeUndefined();
  });

  // M2, fixed at the boundary rather than at a reader: targetOf() already
  // truncated tool_input.command to 80 characters but did not normalize
  // whitespace, and pendingPermission.summary (store/reduce.ts) shares this
  // exact same source (ev.toolTarget) — a second reader that would have had
  // to be fixed separately had the normalization stayed on the display side.
  it("normalizes whitespace (including line breaks) of a multi-line Bash command extracted from tool_input", () => {
    const raw = JSON.stringify({
      event: 'PreToolUse',
      at: 1,
      payload: {
        session_id: 's',
        cwd: '/x',
        tool_name: 'Bash',
        tool_input: { command: 'node -e "\nconst fs = require(\'fs\')\nconsole.log(fs)"' },
      },
    });
    const ev = parseSpoolFile(raw);
    expect(ev?.toolTarget).toBe('node -e " const fs = require(\'fs\') console.log(fs)"');
  });

  it('normalizes the same multi-line command when it arrives via a PermissionRequest (exact repro of the observed bug)', () => {
    const raw = JSON.stringify({
      event: 'PermissionRequest',
      at: 1,
      payload: {
        session_id: 's',
        cwd: '/x',
        tool_name: 'Bash',
        tool_input: { command: "node -e \"\nconst fs=require('fs')\n…\"" },
      },
    });
    const ev = parseSpoolFile(raw);
    expect(ev?.toolTarget).not.toMatch(/\n/);
    expect(ev?.toolTarget).toBe("node -e \" const fs=require('fs') …\"");
  });

  it('also normalizes whitespace in the message field (pendingPermission.summary second fallback)', () => {
    const raw = JSON.stringify({
      event: 'PermissionRequest',
      at: 1,
      payload: { session_id: 's', cwd: '/x', message: 'ligne 1\nligne 2' },
    });
    const ev = parseSpoolFile(raw);
    expect(ev?.message).toBe('ligne 1 ligne 2');
  });

  it("ignores a tool_input value that contains only whitespace and falls back to the next key", () => {
    const raw = JSON.stringify({
      event: 'PreToolUse',
      at: 1,
      payload: {
        session_id: 's',
        cwd: '/x',
        tool_name: 'Read',
        tool_input: { file_path: '   ', path: '/real/path' },
      },
    });
    const ev = parseSpoolFile(raw);
    expect(ev?.toolTarget).toBe('/real/path');
  });
});
