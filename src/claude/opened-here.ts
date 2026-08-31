import type { ClaudeTab } from './dormant';

/** Combien de temps une ouverture demandée attend de voir apparaître son onglet. */
export const PENDING_OPEN_MS = 15_000;

/** L'onglet actif, tel que cette mémoire a besoin de le connaître. */
export interface ActiveTab {
  title: string;
  group: number;
  index: number;
}

/**
 * Les onglets que CETTE fenêtre a elle-même fait ouvrir.
 *
 * Le mémento de l'éditeur est la seule table qui relie un onglet à sa
 * conversation, mais c'est de l'état persisté : il ignore un onglet tout juste
 * rouvert. La fenêtre, elle, sait — c'est elle qui l'a demandé. Reste à
 * reconnaître l'onglet quand il arrive, et c'est tout l'objet de cette classe.
 *
 * Deux pièges, tous deux observés :
 *
 * Le premier événement d'onglet suit la demande de quelques millisecondes et
 * précède l'apparition du panneau : l'onglet actif est encore celui d'avant,
 * souvent un simple fichier. Une attente qui se consommerait là serait perdue
 * pour l'onglet qui arrive juste après. Elle survit donc à tout ce qui n'est
 * pas une conversation.
 *
 * Et le panneau apparaît sous « Claude Code » avant de prendre son titre une
 * demi-seconde plus tard. Retenir la première étiquette donnerait une
 * association périmée aussitôt : l'attente reste ouverte et se ré-enregistre
 * à chaque passage, si bien que c'est la dernière observation qui compte.
 *
 * Elle ne se referme que sur une AUTRE conversation reconnue — l'utilisateur
 * est passé à autre chose — ou par expiration.
 */
export class OpenedHere {
  private readonly known = new Map<string, ClaudeTab>();
  private pending: { id: string; at: number; from?: string } | undefined;

  constructor(private readonly ttlMs: number = PENDING_OPEN_MS) {}

  /** Cette fenêtre vient de demander l'onglet de `sessionId`. */
  opening(sessionId: string, now: number): void {
    this.pending = { id: sessionId, at: now };
  }

  /**
   * Ce qu'on a appris, à placer DEVANT le mémento. Même forme qu'une entrée de
   * mémento : la résolution n'a rien de particulier à faire de celles-ci.
   */
  entries(): ClaudeTab[] {
    return [...this.known.values()];
  }

  /**
   * Prend acte de l'onglet actif, et rend la conversation à sélectionner.
   *
   * `resolved` est ce que la résolution habituelle a trouvé — `undefined` quand
   * personne ne sait encore nommer cet onglet. `active` est `undefined` dès que
   * l'onglet actif n'est pas une conversation.
   */
  observe(resolved: string | undefined, active: ActiveTab | undefined, now: number): string | undefined {
    if (this.pending !== undefined && now - this.pending.at > this.ttlMs) this.pending = undefined;
    if (this.pending === undefined || active === undefined) return resolved;
    if (resolved !== undefined && resolved !== this.pending.id) {
      // La conversation D'OÙ L'ON VIENT ne compte pas : au moment de la demande,
      // l'onglet actif est encore le précédent, et c'est souvent une
      // conversation. La prendre pour un changement d'avis fermait l'attente
      // avant même que le panneau demandé n'apparaisse — le défaut qui rendait
      // la sélection intermittente. La première observée est donc retenue comme
      // le point de départ, et la revoir ne prouve rien.
      this.pending.from ??= resolved;
      if (resolved === this.pending.from) return resolved;
      // Une TROISIÈME conversation, en revanche : l'utilisateur est passé à
      // autre chose, et continuer à guetter finirait par nommer le mauvais onglet.
      this.pending = undefined;
      return resolved;
    }
    this.known.set(this.pending.id, { sessionId: this.pending.id, ...active });
    return this.pending.id;
  }
}
