import { HOOK_EVENTS, LOCAL_EVENTS, type EventName, type SpoolEvent } from './types';
import { isRecord, nonEmptyString } from '../lib/json';

const NAMES: readonly string[] = [...HOOK_EVENTS, ...LOCAL_EVENTS];

/**
 * Réduit toute suite de blancs (espaces, tabulations, retours à la ligne) à
 * un seul espace. Toute valeur destinée à l'affichage passe par ici, à la
 * frontière où elle entre dans le système — jamais chez l'un de ses
 * lecteurs : `currentAction.target` et `pendingPermission.summary`
 * (store/reduce.ts) partagent la même source (`ev.toolTarget`), et
 * `ev.message` alimente aussi ce second champ en repli. Normaliser une fois
 * ici couvre les deux, et tout futur lecteur, sans qu'il ait à y penser.
 */
function normalizeWhitespace(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/** `nonEmptyString()` puis normalisation des blancs ; vide après normalisation = absent. */
function displayText(v: unknown): string | undefined {
  const s = nonEmptyString(v);
  if (s === undefined) return undefined;
  const normalized = normalizeWhitespace(s);
  return normalized.length > 0 ? normalized : undefined;
}

function isEventName(v: string): v is EventName {
  return NAMES.includes(v);
}

// Liste blanche, pas liste noire : les session_id réels observés sont des
// UUID (chiffres hexadécimaux et tirets). N'importe quel autre caractère —
// `/`, `\`, un octet NUL, un espace, un caractère exotique — est refusé par
// construction, sans qu'il faille l'énumérer un par un. Une liste de
// caractères interdits en oublie toujours un (M7 initial ne bloquait que
// `/`, `\`, `.` et `..` : un octet NUL passait).
const SAFE_SESSION_ID = /^[A-Za-z0-9._-]+$/;

/**
 * `writeSession`/`readSession` utilisent `session_id` tel quel dans un nom de
 * fichier (`sessions/<id>.json`, `.tmp-<id>-<pid>-<seq>`) : un id inutilisable
 * comme composant de chemin produit un `ENOENT` à l'écriture — une donnée mal
 * formée ne doit jamais faire lever une écriture en aval, elle doit être
 * refusée ici, à la frontière.
 *
 * Exported: `closed/model.ts` applies the SAME rule to the entries it reads
 * back from `closed.json`, and an id read from that file ends up on a command
 * line (`claude --resume <id>`). One rule, one place.
 */
export function isValidSessionId(id: string): boolean {
  return id !== '.' && id !== '..' && SAFE_SESSION_ID.test(id);
}

/** Première cible lisible d'un appel d'outil, normalisée puis tronquée pour l'affichage. */
function targetOf(toolInput: Record<string, unknown> | undefined): string | undefined {
  if (toolInput === undefined) return undefined;
  for (const key of ['file_path', 'command', 'path', 'pattern', 'url']) {
    const value = displayText(toolInput[key]);
    if (value === undefined) continue;
    return value.length > 80 ? `${value.slice(0, 79)}…` : value;
  }
  return undefined;
}

/**
 * Valide un fichier de spool. Retourne `undefined` pour tout ce qui n'est pas
 * exploitable — un payload d'une future version de Claude Code ne doit jamais
 * faire tomber l'extension.
 */
export function parseSpoolFile(raw: string): SpoolEvent | undefined {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!isRecord(json)) return undefined;

  const event = nonEmptyString(json['event']);
  const at = typeof json['at'] === 'number' && Number.isFinite(json['at']) ? json['at'] : undefined;
  if (event === undefined || at === undefined || !isEventName(event)) return undefined;

  const payload = isRecord(json['payload']) ? json['payload'] : {};
  const sessionId = nonEmptyString(payload['session_id']);
  const cwd = nonEmptyString(payload['cwd']);
  if (sessionId === undefined || cwd === undefined || !isValidSessionId(sessionId)) return undefined;

  const toolInput = isRecord(payload['tool_input']) ? payload['tool_input'] : undefined;

  return {
    event,
    at,
    entrypoint: nonEmptyString(json['entrypoint']) ?? '',
    termProgram: nonEmptyString(json['termProgram']) ?? '',
    sessionId,
    cwd,
    transcriptPath: nonEmptyString(payload['transcript_path']),
    toolName: nonEmptyString(payload['tool_name']),
    toolTarget: targetOf(toolInput),
    message: displayText(payload['message']),
    // Present only on the calls a subagent makes. Read as plain strings and
    // never trusted further: they end up as a map key and as an icon, nothing
    // that touches the filesystem.
    agentId: nonEmptyString(payload['agent_id']),
    agentType: nonEmptyString(payload['agent_type']),
  };
}
