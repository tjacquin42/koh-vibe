import { DEFAULT_DONE_SOUND, DEFAULT_WAITING_SOUND } from '../sound/bundled';
import { clampVolume, DEFAULT_VOLUME } from '../sound/player';
import { isRecord } from '../lib/json';

/**
 * Les réglages du son, partagés entre TOUS les éditeurs de la machine.
 *
 * Ils vivaient dans les réglages VSCode, donc dans ceux de chaque éditeur pris
 * séparément : la même machine annonçait « Chute 3 » dans une fenêtre et
 * « Funk » dans l'autre, pour le même carillon et le même utilisateur. Le
 * classement en dossiers avait déjà tranché la question — un fichier partagé
 * sous `~/.koh-vibe` — et il n'y avait aucune raison que le son y échappe.
 *
 * Ce qui reste propre à chaque éditeur : rien. Un son est une propriété de la
 * machine (ses haut-parleurs, sa bibliothèque), pas de la fenêtre qui l'a
 * choisi.
 */
export interface AppSettings {
  waiting: string;
  done: string;
  volume: number;
  /**
   * What closing a tab does to its conversation. `true`: the row stays in the
   * list, greyed out, in its folder, and a click reopens it. `false`: the row
   * goes, and the conversation is only kept in the "Recently closed" history.
   *
   * Shared like the sounds, and for a stronger reason: the drain that applies
   * `SessionEnd` runs in every window, and two windows applying two different
   * policies to the same file would fight over it.
   */
  persistent: boolean;
  /**
   * Whether a conversation left out of every folder — a temporary one —
   * leaves the list after a day without activity (store/temporary.ts).
   */
  expireTemporary: boolean;
}

/**
 * What the dashboard chimes with before anyone has chosen anything.
 *
 * Two sounds rather than silence: a notification nobody ever hears teaches
 * nothing about itself — someone who installs the extension has to hear it once
 * to know it exists, and only then decide to change it or turn it off.
 *
 * A default only ever fills a hole. Everything the user has settled — a sound,
 * or the silence they asked for — is a value in the settings file, and a value
 * is never replaced by a default: see `parseSettings` and `seedSettings`.
 */
export function defaultSettings(): AppSettings {
  return { waiting: DEFAULT_WAITING_SOUND, done: DEFAULT_DONE_SOUND, volume: DEFAULT_VOLUME, persistent: true, expireTemporary: true };
}

function sound(v: unknown, fallback: string): string {
  return typeof v === 'string' ? v : fallback;
}

function flag(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

/**
 * Un fichier illisible vaut « réglages par défaut » : le tableau de bord doit
 * s'afficher quoi qu'il arrive, et un carillon muet se rattrape en deux clics.
 *
 * Chaque champ retombe SÉPARÉMENT sur sa valeur par défaut : un volume abîmé ne
 * doit pas emporter avec lui le choix des sons.
 */
export function parseSettings(raw: string): AppSettings {
  let root: unknown;
  try {
    root = JSON.parse(raw);
  } catch {
    return defaultSettings();
  }
  if (!isRecord(root)) return defaultSettings();
  const base = defaultSettings();
  return {
    waiting: sound(root['waiting'], base.waiting),
    done: sound(root['done'], base.done),
    // `clampVolume` retombe déjà sur la valeur par défaut plutôt que sur le
    // silence : un réglage abîmé ne doit pas se traduire par « le son ne marche
    // plus », qui enverrait chercher la panne ailleurs.
    volume: clampVolume(root['volume']),
    persistent: flag(root['persistent'], base.persistent),
    expireTemporary: flag(root['expireTemporary'], base.expireTemporary),
  };
}

export function serializeSettings(s: AppSettings): string {
  return `${JSON.stringify(
    { version: 1, waiting: s.waiting, done: s.done, volume: clampVolume(s.volume), persistent: s.persistent, expireTemporary: s.expireTemporary },
    null,
    2,
  )}\n`;
}

/**
 * What this editor kept in its own VSCode settings, read once by the migration.
 *
 * A key the editor never held falls back to the DEFAULT, never to silence. This
 * is the path a fresh install takes — there is nothing to migrate — and reading
 * that emptiness as « the user asked for quiet » would freeze silence into the
 * shared file on the very first launch. The default could then never apply
 * again, since `seedSettings` rightly leaves an existing file alone.
 */
export function settingsFromEditor(read: (key: string) => unknown): AppSettings {
  const base = defaultSettings();
  return {
    waiting: sound(read('sound.waiting'), base.waiting),
    done: sound(read('sound.done'), base.done),
    volume: clampVolume(read('sound.volume')),
    // Never an editor setting: nothing to migrate, the default applies.
    persistent: base.persistent,
    expireTemporary: base.expireTemporary,
  };
}
