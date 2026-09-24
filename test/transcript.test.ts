import { mkdtempSync, rmSync } from 'node:fs';
import { appendFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readTranscript, type TranscriptStats } from '../src/transcript/reader';

// `open` est mocké pour un seul test (M8) : il permet de simuler un `read()`
// qui renvoie moins d'octets que demandé (fichier tronqué entre `stat()` et
// `read()`) sans dépendre d'une vraie course contre le système de fichiers,
// donc piloté plutôt que chronométré. Délègue à l'implémentation réelle sauf
// quand ce test arme `openOverride`.
const { openOverride } = vi.hoisted(() => ({
  openOverride: {
    current: undefined as
      | (() => Promise<{
          stat: () => Promise<{ size: number }>;
          read: (buffer: Buffer, offset: number, length: number, position: number) => Promise<{ bytesRead: number }>;
          close: () => Promise<void>;
        }>)
      | undefined,
  },
}));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    open: (path: Parameters<typeof actual.open>[0], flags: Parameters<typeof actual.open>[1]) =>
      openOverride.current !== undefined ? openOverride.current() : actual.open(path, flags),
  };
});

let dir: string;
let file: string;

const assistant = (input: number, output: number): string =>
  `${JSON.stringify({
    type: 'assistant',
    sessionId: 's1',
    cwd: '/Users/dev/projet',
    gitBranch: 'feat-seo',
    entrypoint: 'claude-vscode',
    isSidechain: false,
    message: { usage: { input_tokens: input, output_tokens: output, cache_read_input_tokens: 10 } },
  })}\n`;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'koh-'));
  file = join(dir, 't.jsonl');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  openOverride.current = undefined;
});

// Utilitaires pour les tests de titre : écrivent des lignes JSONL brutes dans
// le fichier temporaire du test courant, sans passer par le format des
// entrées `assistant` ci-dessus.
const fixture = async (lines: string[]): Promise<string> => {
  await writeFile(file, lines.map((l) => `${l}\n`).join(''));
  return file;
};

const appendLine = (path: string, line: string): Promise<void> => appendFile(path, `${line}\n`);

const rewrite = (path: string, lines: string[]): Promise<void> => writeFile(path, lines.map((l) => `${l}\n`).join(''));

describe('readTranscript', () => {
  it('somme les tokens et retient la branche', async () => {
    await writeFile(file, assistant(100, 20) + assistant(50, 5));
    const stats = await readTranscript(file);
    expect(stats.input).toBe(150);
    expect(stats.output).toBe(25);
    expect(stats.branch).toBe('feat-seo');
  });

  it('écarte « HEAD », qui n est pas une branche mais l absence de branche', async () => {
    // Ce que Claude Code écrit pour un dossier hors dépôt git, ou une tête
    // détachée. Affiché tel quel, il donnait « DEV · HEAD » : un libellé qui
    // ressemble à une information alors qu il n en porte aucune.
    await writeFile(file, assistant(100, 20).replace('"gitBranch":"feat-seo"', '"gitBranch":"HEAD"'));
    expect((await readTranscript(file)).branch).toBeUndefined();
  });

  it('ne confond pas HEAD avec une branche dont le nom le contient', async () => {
    await writeFile(file, assistant(100, 20).replace('"gitBranch":"feat-seo"', '"gitBranch":"feat/HEAD-fix"'));
    expect((await readTranscript(file)).branch).toBe('feat/HEAD-fix');
  });

  it('reprend là où elle s est arrêtée sans recompter', async () => {
    await writeFile(file, assistant(100, 20));
    const first = await readTranscript(file);
    await appendFile(file, assistant(7, 3));
    const second = await readTranscript(file, first);
    expect(second.input).toBe(107);
    expect(second.output).toBe(23);
  });

  it('ne consomme pas une ligne encore incomplète', async () => {
    await writeFile(file, `${assistant(10, 1)}{"type":"assist`);
    const stats = await readTranscript(file);
    expect(stats.input).toBe(10);
    // la ligne partielle sera relue au prochain passage
    await appendFile(file, `ant","message":{"usage":{"input_tokens":5,"output_tokens":1}}}\n`);
    const next = await readTranscript(file, stats);
    expect(next.input).toBe(15);
  });

  it('ignore les lignes non-assistant et les lignes illisibles', async () => {
    await writeFile(file, `{"type":"user"}\n{ cassé\n${assistant(9, 1)}`);
    const stats = await readTranscript(file);
    expect(stats.input).toBe(9);
    expect(stats.output).toBe(1);
  });

  it('retourne un état vide si le fichier n existe pas', async () => {
    const stats = await readTranscript('/nexiste/pas.jsonl');
    expect(stats).toEqual({ offset: 0, input: 0, output: 0 });
  });

  it('repart de zéro si le fichier a été remplacé par un plus court (rotation / nouvelle session)', async () => {
    const stale: TranscriptStats = {
      offset: 5000,
      input: 99999,
      output: 88888,
      branch: 'old-branch',
    };
    await writeFile(file, assistant(10, 20) + assistant(5, 5));
    const stats = await readTranscript(file, stale);
    expect(stats.input).toBe(15);
    expect(stats.output).toBe(25);
    expect(stats.branch).toBe('feat-seo');
    expect(stats.offset).toBeLessThan(stale.offset);
  });

  it("ne décode pas au-delà de bytesRead quand read() renvoie moins que ce qui a été demandé (M8)", async () => {
    // stat() ment sur la taille (comme si le fichier venait d'être tronqué
    // après le stat() réel mais avant le read()) : le buffer alloué est donc
    // plus grand que ce que read() remplit réellement. Le reste du buffer
    // contient, dans ce test, un fragment décodable d'un « ancien » transcript
    // — le pire cas plausible avec `allocUnsafe`, où la mémoire réutilisée est
    // un fragment d'une lecture précédente plutôt que du vrai hasard.
    const real = assistant(10, 1);
    const ghost = assistant(99999, 88888);
    const realLen = Buffer.byteLength(real, 'utf8');

    openOverride.current = () =>
      Promise.resolve({
        stat: () => Promise.resolve({ size: realLen + 5000 }),
        read: (buffer, offset, _length, _position) => {
          buffer.write(real, offset, 'utf8');
          buffer.write(ghost, offset + realLen, 'utf8');
          return Promise.resolve({ bytesRead: realLen });
        },
        close: () => Promise.resolve(undefined),
      });

    const stats = await readTranscript(file);

    expect(stats.input).toBe(10);
    expect(stats.output).toBe(1);
  });
});

describe('readTranscript — titre de la conversation', () => {
  it('retient le dernier ai-title vu', async () => {
    const p = await fixture(['{"type":"ai-title","aiTitle":"un"}', '{"type":"ai-title","aiTitle":"deux"}']);
    expect((await readTranscript(p)).title).toBe('deux');
  });

  it('customTitle prime sur ai-title, même écrit avant', async () => {
    const p = await fixture(['{"type":"custom-title","customTitle":"#à moi"}', '{"type":"ai-title","aiTitle":"engendré"}']);
    expect((await readTranscript(p)).title).toBe('#à moi');
  });

  it('pas de titre quand le transcript n en porte aucun — ni titre, ni prompt', async () => {
    const p = await fixture([assistant(1, 1)]);
    expect((await readTranscript(p)).title).toBeUndefined();
  });

  it('un titre vide ou fait d espaces ne compte pas', async () => {
    const p = await fixture(['{"type":"ai-title","aiTitle":"   "}']);
    expect((await readTranscript(p)).title).toBeUndefined();
  });

  it('conserve le titre au fil des lectures incrémentales', async () => {
    const p = await fixture(['{"type":"ai-title","aiTitle":"posé tôt"}']);
    const un = await readTranscript(p);
    await appendLine(p, '{"type":"assistant","message":{"usage":{"input_tokens":1,"output_tokens":1}}}');
    expect((await readTranscript(p, un)).title).toBe('posé tôt');
  });

  it('oublie le titre quand le transcript rétrécit', async () => {
    const p = await fixture(['{"type":"ai-title","aiTitle":"ancien"}']);
    const un = await readTranscript(p);
    // Rétrécit réellement en octets (16 < 39) : le contenu du brief
    // (`{"type":"user","message":{"role":"user","content":"neuf"}}`, 59
    // octets) est plus long que la ligne d'origine et ne déclenche donc pas
    // le mécanisme de reset existant, basé sur la taille du fichier.
    await rewrite(p, ['{"type":"user"}']);
    expect((await readTranscript(p, un)).title).toBeUndefined();
  });

  it('reprend le dernier customTitle sur un transcript réaliste (fixture titles.jsonl)', async () => {
    const stats = await readTranscript('test/fixtures/transcripts/titles.jsonl');
    expect(stats.title).toBe('#Mon titre');
  });
});

describe('readTranscript — titre sans titre : la règle de l’extension Claude Code', () => {
  const user = (text: string, extra = ''): string =>
    JSON.stringify({ type: 'user', message: { role: 'user', content: text }, ...(extra ? JSON.parse(extra) : {}) });

  it('prend le premier prompt quand aucun titre n’a été engendré', async () => {
    const path = await fixture([user('bonjour'), JSON.stringify({ type: 'last-prompt', lastPrompt: 'bonjour' }), JSON.stringify({ type: 'atis-latch', atis: '' })]);
    expect((await readTranscript(path)).title).toBe('bonjour');
  });

  it('ne change plus de nom au fil des prompts, s’arrête sur le titre IA dès qu’il arrive, et cède au titre choisi', async () => {
    const path = await fixture([user('bonjour'), JSON.stringify({ type: 'last-prompt', lastPrompt: 'bonjour' })]);
    let stats = await readTranscript(path);
    await appendLine(path, JSON.stringify({ type: 'last-prompt', lastPrompt: 'et maintenant ?' }));
    stats = await readTranscript(path, stats);
    expect(stats.title).toBe('bonjour');
    await appendLine(path, JSON.stringify({ type: 'ai-title', aiTitle: 'Salutations' }));
    stats = await readTranscript(path, stats);
    expect(stats.title).toBe('Salutations');
    await appendLine(path, JSON.stringify({ type: 'last-prompt', lastPrompt: 'encore' }));
    stats = await readTranscript(path, stats);
    expect(stats.title).toBe('Salutations');
    await appendLine(path, JSON.stringify({ type: 'custom-title', customTitle: '#Perso' }));
    stats = await readTranscript(path, stats);
    expect(stats.title).toBe('#Perso');
  });

  it('préfère le premier message au résumé — et ne prend jamais un résultat d’outil pour un prompt', async () => {
    const toolResult = JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'x', content: 'ok' }] } });
    const path = await fixture([toolResult, user('Corrige le bug du menu'), JSON.stringify({ type: 'summary', summary: 'Bug du menu corrigé' })]);
    expect((await readTranscript(path)).title).toBe('Corrige le bug du menu');
    // Sans premier message lisible, le résumé d’une compaction passe devant le dernier prompt.
    const compacted = await fixture([
      toolResult,
      JSON.stringify({ type: 'summary', summary: 'Bug du menu corrigé' }),
      JSON.stringify({ type: 'last-prompt', lastPrompt: 'et ensuite ?' }),
    ]);
    expect((await readTranscript(compacted)).title).toBe('Bug du menu corrigé');
  });

  it('ne garde d’un prompt que sa première ligne, blancs repliés et coupée court — comme l’onglet', async () => {
    const long = `   Voici   un prompt   ${'x'.repeat(120)}\n deuxième ligne, ignorée`;
    const path = await fixture([JSON.stringify({ type: 'last-prompt', lastPrompt: long })]);
    const title = (await readTranscript(path)).title ?? '';
    expect(title.startsWith('Voici un prompt')).toBe(true);
    expect(title.length).toBe(80);
    expect(title.endsWith('…')).toBe(true);
    expect(title).not.toContain('\n');
  });

  it('ne prend jamais un résumé de compaction pour le premier prompt — il sert de résumé', async () => {
    // `type: "summary"` a disparu des transcripts (0 occurrence sur les 17 plus
    // récents) : une compaction arrive désormais en `user` marqué
    // `isCompactSummary`. Sans ce filtre, une conversation reprise après
    // compaction se serait appelée « This session is being continued… ».
    const compact = JSON.stringify({
      type: 'user',
      isCompactSummary: true,
      message: { role: 'user', content: 'This session is being continued from a previous conversation.' },
    });
    const path = await fixture([compact, user('range mes worktrees')]);
    const stats = await readTranscript(path);
    expect(stats.firstPrompt).toBe('range mes worktrees');
    expect(stats.summary).toBe('This session is being continued from a previous conversation.');
    expect(stats.title).toBe('range mes worktrees');
  });

  it('retombe sur le résumé de compaction quand la conversation n’a pas d’autre prompt lisible', async () => {
    const compact = JSON.stringify({
      type: 'user',
      isCompactSummary: true,
      message: { role: 'user', content: 'Reprise : migration Turso en cours' },
    });
    const path = await fixture([compact, JSON.stringify({ type: 'last-prompt', lastPrompt: 'et ensuite ?' })]);
    expect((await readTranscript(path)).title).toBe('Reprise : migration Turso en cours');
  });

  it('ignore les messages méta et les branches secondaires pour le premier message', async () => {
    const path = await fixture([user('<system>', '{"isMeta":true}'), user('sous-agent', '{"isSidechain":true}'), user('la vraie question')]);
    expect((await readTranscript(path)).title).toBe('la vraie question');
  });
});

describe('readTranscript — le titre de repli ne montre jamais la tuyauterie', () => {
  // Les blocs d'un message d'utilisateur, tels que Claude Code les écrit : le
  // contexte que l'éditeur injecte vient dans SON bloc, avant le prompt.
  const blocks = (...texts: string[]): string =>
    JSON.stringify({ type: 'user', message: { role: 'user', content: texts.map((text) => ({ type: 'text', text })) } });

  it('nomme une conversation ouverte par une commande d’après la commande, jamais d’après son préambule', async () => {
    const path = await fixture([
      blocks('<command-message>clean-work-space</command-message>\n<command-name>/clean-work-space</command-name>'),
    ]);
    expect((await readTranscript(path)).title).toBe('/clean-work-space');
  });

  it('préfère ce qu’on a demandé à la commande au nom de la commande', async () => {
    const path = await fixture([
      blocks('<command-message>using-superpowers</command-message>\n<command-name>/superpowers:using-superpowers</command-name>\n<command-args>range mes worktrees\net dis-moi ce que tu as tué</command-args>'),
    ]);
    expect((await readTranscript(path)).title).toBe('range mes worktrees');
  });

  it('saute le contexte injecté par l’éditeur et prend le premier vrai prompt', async () => {
    const path = await fixture([blocks('<ide_opened_file>The user opened a file.</ide_opened_file>', 'range mes worktrees')]);
    expect((await readTranscript(path)).title).toBe('range mes worktrees');
  });

  it('garde le nom de la commande d’ouverture quand la conversation continue — sinon un « ? » suffisait à la renommer', async () => {
    const path = await fixture([blocks('<command-name>/clean-work-space</command-name>')]);
    let stats = await readTranscript(path);
    expect(stats.title).toBe('/clean-work-space');
    await appendLine(path, blocks('?'));
    stats = await readTranscript(path, stats);
    expect(stats.title).toBe('/clean-work-space');
  });

  it('cherche dans le message suivant quand le premier ne dit rien du tout', async () => {
    const path = await fixture([blocks('<ide_opened_file>The user opened a file.</ide_opened_file>'), blocks('range mes worktrees')]);
    expect((await readTranscript(path)).title).toBe('range mes worktrees');
  });

  it('affiche une commande shell comme l’onglet : « ! » puis la commande', async () => {
    const path = await fixture([blocks('<bash-input>git status</bash-input>')]);
    expect((await readTranscript(path)).title).toBe('! git status');
  });

  it('ne retient ni le contexte seul ni un résultat d’outil', async () => {
    const toolResult = JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'x', content: 'ok' }] } });
    const path = await fixture([toolResult, blocks('<ide_selection>The user selected a line.</ide_selection>')]);
    expect((await readTranscript(path)).title).toBeUndefined();
  });
});
