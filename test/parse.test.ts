import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseSpoolFile } from '../src/events/parse';

const fixture = (name: string): string =>
  readFileSync(`test/fixtures/hooks/${name}.json`, 'utf8');

describe('parseSpoolFile', () => {
  it('normalises a real PreToolUse', () => {
    const ev = parseSpoolFile(fixture('PreToolUse'));
    expect(ev?.event).toBe('PreToolUse');
    expect(ev?.sessionId).not.toBe('');
    expect(ev?.cwd).not.toBe('');
    expect(ev?.toolName).toBeDefined();
  });

  it('rejects invalid JSON without throwing', () => {
    expect(parseSpoolFile('{ pas du json')).toBeUndefined();
  });

  it('rejects an unknown event', () => {
    expect(parseSpoolFile('{"event":"Inconnu","at":1,"payload":{}}')).toBeUndefined();
  });

  it('rejects a payload with no session_id', () => {
    expect(parseSpoolFile('{"event":"Stop","at":1,"payload":{"cwd":"/x"}}')).toBeUndefined();
  });

  it('tolerates a missing entrypoint and termProgram', () => {
    const ev = parseSpoolFile('{"event":"Stop","at":5,"payload":{"session_id":"s","cwd":"/x"}}');
    expect(ev?.entrypoint).toBe('');
    expect(ev?.at).toBe(5);
  });

  it('extracts the target out of tool_input', () => {
    const ev = parseSpoolFile(
      '{"event":"PreToolUse","at":1,"payload":{"session_id":"s","cwd":"/x","tool_name":"Edit","tool_input":{"file_path":"/x/a.ts"}}}',
    );
    expect(ev?.toolTarget).toBe('/x/a.ts');
  });

  it('rejects a session_id holding a path separator', () => {
    // "a/b" produit sessions/.tmp-a/b-<pid> côté writeSession → ENOENT. Un
    // identifiant de session doit être utilisable comme nom de fichier.
    expect(parseSpoolFile('{"event":"Stop","at":1,"payload":{"session_id":"a/b","cwd":"/x"}}')).toBeUndefined();
  });

  it('rejects a session_id holding a backslash', () => {
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

  it('rejects a session_id holding a NUL byte (N3: an allow list, not a list of forbidden characters)', () => {
    // L'octet NUL franchit une validation qui ne raisonnerait que par liste noire
    // ('/', '\', '.', '..') : il ne figure dans aucune de ces exclusions, et
    // pourtant reste inutilisable dans un nom de fichier. La frontière doit
    // dire ce qui EST permis, pas énumérer ce qui ne l'est pas.
    expect(
      parseSpoolFile('{"event":"Stop","at":1,"payload":{"session_id":"a\\u0000b","cwd":"/x"}}'),
    ).toBeUndefined();
  });

  it('rejects a session_id holding a space or any exotic character', () => {
    expect(parseSpoolFile('{"event":"Stop","at":1,"payload":{"session_id":"a b","cwd":"/x"}}')).toBeUndefined();
    expect(parseSpoolFile('{"event":"Stop","at":1,"payload":{"session_id":"a✨b","cwd":"/x"}}')).toBeUndefined();
  });

  // M2, corrigé à la frontière plutôt que chez un lecteur : targetOf() tronquait
  // déjà tool_input.command à 80 caractères mais ne normalisait pas les blancs,
  // et pendingPermission.summary (store/reduce.ts) partage exactement cette
  // même source (ev.toolTarget) — un second lecteur qui aurait fallu penser à
  // corriger séparément si la normalisation était restée côté affichage.
  it('normalises the whitespace (newlines included) of a multi-line Bash command read out of tool_input', () => {
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

  it('normalises the same multi-line command when it arrives through a PermissionRequest (an exact repro of the observed defect)', () => {
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

  it('normalises the whitespace of the message field too (the second fallback of pendingPermission.summary)', () => {
    const raw = JSON.stringify({
      event: 'PermissionRequest',
      at: 1,
      payload: { session_id: 's', cwd: '/x', message: 'ligne 1\nligne 2' },
    });
    const ev = parseSpoolFile(raw);
    expect(ev?.message).toBe('ligne 1 ligne 2');
  });

  it('ignores a tool_input value made of whitespace only and falls back to the next key', () => {
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
