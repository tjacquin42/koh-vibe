import { open } from 'node:fs/promises';
import { isRecord } from '../lib/json';

export interface TranscriptStats {
  offset: number;
  input: number;
  output: number;
  branch?: string;
  /** Titre choisi par l'utilisateur. Prime toujours. */
  customTitle?: string;
  /** Dernier titre engendré par Claude. */
  aiTitle?: string;
  /** Le dernier prompt, tel que Claude Code le note (`last-prompt`). */
  lastPrompt?: string;
  /** Le dernier résumé de compaction (`summary`). */
  summary?: string;
  /** Le premier message de l'utilisateur, faute de tout le reste. */
  firstPrompt?: string;
  /**
   * Dérivé — le seul champ que l'affichage consomme — par la règle de
   * l'extension Claude Code elle-même pour nommer un onglet et lister les
   * sessions : `customTitle ?? aiTitle ?? lastPrompt ?? summary ?? firstPrompt`.
   * Un titre IA n'est pas engendré pour un échange trop court (« bonjour »),
   * et l'onglet porte alors le prompt : la liste doit dire la même chose.
   */
  title?: string;
}

/** What the tab shows of a prompt: its first line, whitespace folded, cut short. */
const PROMPT_TITLE_MAX = 80;
function promptTitle(v: unknown): string | undefined {
  const t = text(v);
  if (t === undefined) return undefined;
  const line = (t.split('\n').find((l) => l.trim().length > 0) ?? '').replace(/\s+/g, ' ').trim();
  if (line.length === 0) return undefined;
  return line.length > PROMPT_TITLE_MAX ? `${line.slice(0, PROMPT_TITLE_MAX - 1)}…` : line;
}

/** The text of a user record's message — a string, or the text blocks of an array; never a tool result. */
function userText(message: unknown): string | undefined {
  if (!isRecord(message)) return undefined;
  const content = message['content'];
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return undefined;
  const parts: string[] = [];
  for (const block of content) {
    if (!isRecord(block)) continue;
    if (block['type'] === 'tool_result') return undefined;
    if (block['type'] === 'text' && typeof block['text'] === 'string') parts.push(block['text']);
  }
  return parts.length > 0 ? parts.join('\n') : undefined;
}

const EMPTY: TranscriptStats = { offset: 0, input: 0, output: 0 };

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function text(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  return t.length > 0 ? t : undefined;
}

/**
 * Lit un transcript JSONL depuis `from.offset`. L'offset n'avance que jusqu'au
 * dernier saut de ligne : une ligne encore en cours d'écriture est relue au
 * passage suivant plutôt que comptée à moitié.
 */
export async function readTranscript(path: string, from?: TranscriptStats): Promise<TranscriptStats> {
  const requested = from ?? EMPTY;
  let handle;
  try {
    handle = await open(path, 'r');
  } catch {
    return { ...requested };
  }

  try {
    const { size } = await handle.stat();
    if (size === requested.offset) return { ...requested };
    // Le fichier est plus court que l'offset mémorisé : ce n'est plus le
    // transcript qu'on suivait (remplacé, ou nouvelle session qui a repris
    // le même chemin). On oublie l'état précédent et on relit depuis le
    // début, pour ne pas garder des totaux périmés indéfiniment.
    const start = size < requested.offset ? EMPTY : requested;
    if (size <= start.offset) return { ...start, offset: Math.min(start.offset, size) };

    const length = size - start.offset;
    const buffer = Buffer.allocUnsafe(length);
    const { bytesRead } = await handle.read(buffer, 0, length, start.offset);
    // Bornée à bytesRead : au-delà, allocUnsafe n'a rien écrit — c'est de la
    // mémoire non initialisée (un fichier tronqué entre stat() et read() en
    // est la cause la plus plausible ici), qui ne doit jamais être décodée.
    const chunk = buffer.toString('utf8', 0, bytesRead);

    const lastBreak = chunk.lastIndexOf('\n');
    if (lastBreak < 0) return { ...start };

    const stats: TranscriptStats = { ...start, offset: start.offset + Buffer.byteLength(chunk.slice(0, lastBreak + 1), 'utf8') };

    for (const line of chunk.slice(0, lastBreak).split('\n')) {
      if (line.length === 0) continue;
      let entry: unknown;
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }
      if (!isRecord(entry)) continue;

      // « HEAD » n'est pas un nom de branche mais ce que Claude Code écrit quand
      // il n'y en a pas : dossier hors dépôt git, ou tête détachée. Écarté ici,
      // à la frontière, plutôt que dans le libellé — la même règle que la
      // normalisation des blancs (events/parse.ts) : une valeur qui ne veut rien
      // dire ne doit jamais entrer dans l'état, sinon chaque affichage doit
      // penser à s'en défendre.
      const branch = entry['gitBranch'];
      if (typeof branch === 'string' && branch.length > 0 && branch !== 'HEAD') stats.branch = branch;

      const type = entry['type'];
      if (type === 'custom-title') {
        const t = text(entry['customTitle']);
        if (t !== undefined) stats.customTitle = t;
      } else if (type === 'ai-title') {
        const t = text(entry['aiTitle']);
        if (t !== undefined) stats.aiTitle = t;
      } else if (type === 'last-prompt') {
        const t = promptTitle(entry['lastPrompt']);
        if (t !== undefined) stats.lastPrompt = t;
      } else if (type === 'summary') {
        const t = promptTitle(entry['summary']);
        if (t !== undefined) stats.summary = t;
      } else if (type === 'user' && stats.firstPrompt === undefined && entry['isMeta'] !== true && entry['isSidechain'] !== true) {
        const t = promptTitle(userText(entry['message']));
        if (t !== undefined) stats.firstPrompt = t;
      }

      if (type !== 'assistant') continue;
      const message = entry['message'];
      if (!isRecord(message)) continue;
      const usage = message['usage'];
      if (!isRecord(usage)) continue;

      stats.input += num(usage['input_tokens']);
      stats.output += num(usage['output_tokens']);
    }

    stats.title = stats.customTitle ?? stats.aiTitle ?? stats.lastPrompt ?? stats.summary ?? stats.firstPrompt;
    return stats;
  } finally {
    await handle.close();
  }
}
