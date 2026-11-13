/**
 * The view's strings. English is the default and the fallback, as in V1:
 * a language with no translation, or a key missing from one, shows English —
 * never an empty string or a raw key.
 */

const en = {
  'app.name': 'Koh-Vibe',
  'app.next': 'next',
  'live.on': 'Live',
  'live.wait': 'Waiting for the extension…',
  'count.waiting': 'waiting for you',
  'count.running': 'working',
  'count.done': 'finished',
  'folder.unfiled': 'Unfiled',
  'empty.title': 'No conversation yet',
  'empty.body': 'Start Claude Code anywhere: it shows up here.',
  'status.waiting': 'Waiting for you',
  'status.running': 'Working',
  'status.done_unseen': 'Finished',
  'status.idle': 'Idle',
  'status.ended': 'Ended',
  'session.untitled': 'Untitled conversation',
  'session.tools': '{n} tools',
  'age.now': 'now',
  'age.min': '{n} min',
  'age.hour': '{n} h',
  'age.day': '{n} d',
  'usage.title': 'Usage',
  'usage.fiveHour': '5 hours',
  'usage.weekly': 'Week',
  'usage.none': 'No reading yet',
  'usage.resets': 'resets in {d}',
  'action.cockpit': 'Open the cockpit',
  'action.reload': 'Reload',
  'cockpit.title': 'Cockpit',
  'cockpit.soon': 'The cockpit arrives in step 3. For now it shows the same live data as the sidebar.',
  'footer.readonly': 'Read-only · V1 keeps the hooks',
  'preview.banner': 'Browser preview, sample data',
} as const;

export type Key = keyof typeof en;
type Dict = Partial<Record<Key, string>>;

const fr: Dict = {
  'app.next': 'next',
  'live.on': 'En direct',
  'live.wait': 'En attente de l’extension…',
  'count.waiting': 't’attendent',
  'count.running': 'travaillent',
  'count.done': 'finies',
  'folder.unfiled': 'Sans dossier',
  'empty.title': 'Aucune conversation pour l’instant',
  'empty.body': 'Lance Claude Code n’importe où : elle apparaît ici.',
  'status.waiting': 'T’attend',
  'status.running': 'Travaille',
  'status.done_unseen': 'Finie',
  'status.idle': 'En pause',
  'status.ended': 'Terminée',
  'session.untitled': 'Conversation sans titre',
  'session.tools': '{n} outils',
  'age.now': 'à l’instant',
  'age.min': '{n} min',
  'age.hour': '{n} h',
  'age.day': '{n} j',
  'usage.title': 'Conso',
  'usage.fiveHour': '5 heures',
  'usage.weekly': 'Semaine',
  'usage.none': 'Pas encore de relevé',
  'usage.resets': 'repart dans {d}',
  'action.cockpit': 'Ouvrir le cockpit',
  'action.reload': 'Recharger',
  'cockpit.title': 'Cockpit',
  'cockpit.soon': 'Le cockpit arrive à l’étape 3. Pour l’instant il montre les mêmes données en direct que la barre latérale.',
  'footer.readonly': 'Lecture seule · la V1 garde les hooks',
  'preview.banner': 'Aperçu navigateur, données d’exemple',
};

const DICTS: Record<string, Dict> = { fr };

export type Translate = (key: Key, params?: Record<string, string | number>) => string;

/** "fr", "fr-ca", "FR" all pick French; anything unknown falls back to English. */
export function translator(language: string): Translate {
  const dict = DICTS[language.toLowerCase().split('-')[0] ?? ''] ?? {};
  return (key, params) => {
    const raw = dict[key] ?? en[key];
    if (params === undefined) return raw;
    return raw.replace(/\{(\w+)\}/g, (m, name: string) => {
      const v = params[name];
      return v === undefined ? m : String(v);
    });
  };
}
