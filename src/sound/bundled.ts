import { join } from 'node:path';

/**
 * The two sounds that ship inside the package, and what a fresh install rings.
 *
 * The library next door is deliberately NOT shipped — a hundred files, their
 * weight and each of their licences to hold in a public repository. Two are a
 * different matter: eighty-five kilobytes against the package's hundred and
 * sixty, one licence (CC0, see resources/sounds/CREDITS.md), and in exchange a
 * dashboard that chimes the moment it is installed. A notification nobody ever
 * hears teaches nothing about itself.
 *
 * They are named after WHAT THEY ANNOUNCE, not after the drawer they came from.
 * A name is what the picker shows and what the settings file stores: « Chute 3 »
 * said which family of the library it belonged to and never said when it would
 * ring, which is the only thing the person choosing it cares about.
 *
 * No accent in either name, on purpose. These names travel from a source file
 * to a file name to a settings value, across git, macOS and whatever unpacks
 * the package — and a name that is NFC on one side and NFD on the other looks
 * identical while resolving to nothing.
 */
export function bundledSoundsDir(extensionPath: string): string {
  return join(extensionPath, 'resources', 'sounds');
}

export const DEFAULT_WAITING_SOUND = 'Attente';
export const DEFAULT_DONE_SOUND = 'Fin';
