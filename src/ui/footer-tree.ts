import * as vscode from 'vscode';
import { NO_SOUND } from '../sound/player';
import type { ChimeEvent } from '../sound/model';

/**
 * Les réglages, dans une vue SÉPARÉE de la liste des sessions.
 *
 * VSCode n'offre aucun moyen d'épingler une ligne au bas d'un arbre : tout ce
 * qu'on y met défile avec le reste. Une seconde vue dans le même conteneur, en
 * revanche, se pose sous la première et n'en suit pas le défilement — c'est le
 * seul « fixé en bas » que la plateforme permette.
 */
export interface SoundSettings {
  waiting: string;
  done: string;
  volume: number;
}

/** The two on/off settings, as the shared file names them (settings/model.ts). */
export type SettingToggle = 'persistent' | 'expireTemporary';

export const SETTING_TOGGLES: readonly SettingToggle[] = ['persistent', 'expireTemporary'];

export type FooterNode =
  | { kind: 'toggle'; key: SettingToggle; on: boolean }
  | { kind: 'sound'; event: ChimeEvent; name: string }
  | { kind: 'volume'; volume: number }
  | { kind: 'library'; count: number };

export function toggleLabel(key: SettingToggle): string {
  return key === 'persistent'
    ? vscode.l10n.t('Persistent sessions')
    : vscode.l10n.t('Temporary sessions expire after 24 h');
}

/**
 * What a checkbox means, spelled out where the mouse rests: "persistent" or
 * "temporary" alone says nothing about tabs, folders, or how to come back.
 */
export function toggleTooltip(key: SettingToggle): string {
  return key === 'persistent'
    ? vscode.l10n.t(
        'Keep a conversation in the list after its tab is closed: greyed out, in its folder, a click reopens it.\nUnchecked, closing the tab removes it from the list instead. Rows already greyed stay either way.',
      )
    : vscode.l10n.t(
        'A conversation left out of every folder is temporary: after 24 hours without activity it leaves the list. Any activity brings it back; filing it in a folder keeps it for good.\nUnchecked, temporary conversations stay until you remove them.',
      );
}

/**
 * The title of a sound picker. It names the EVENT, not the level: "sound of
 * this folder" never said what was being set, and the level is already visible
 * in the menu you came through.
 */
export const EVENT_TITLE: Record<ChimeEvent, () => string> = {
  waiting: () => vscode.l10n.t('Sound when a session waits for you'),
  done: () => vscode.l10n.t('Sound when a session finishes'),
};

/** How many sounds the library has laid down, hence whether to install or remove it. */
export function libraryRowLabel(count: number): string {
  return count === 0
    ? vscode.l10n.t('Sound library: install…')
    : vscode.l10n.t('Sound library: {0} sounds', count);
}

/** The row states the current setting rather than vaguely inviting one: "…: Ping" reads at a glance. */
export function soundRowLabel(event: ChimeEvent, name: string): string {
  const sound = name === NO_SOUND ? vscode.l10n.t('none') : name;
  return event === 'waiting'
    ? vscode.l10n.t('Waiting sound: {0}', sound)
    : vscode.l10n.t('Finished sound: {0}', sound);
}

export function volumeRowLabel(volume: number): string {
  return vscode.l10n.t('Volume: {0} %', Math.round(volume * 100));
}

export class FooterTree implements vscode.TreeDataProvider<FooterNode> {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.emitter.event;
  private sound: SoundSettings = { waiting: NO_SOUND, done: NO_SOUND, volume: 0.5 };
  private library = 0;
  private toggles: Record<SettingToggle, boolean> = { persistent: true, expireTemporary: true };
  // Même règle que l'arbre des sessions : ne rien annoncer quand rien n'a
  // changé, sinon l'infobulle s'escamote sous la souris.
  private rendered: string | undefined;

  setSound(sound: SoundSettings): void {
    this.sound = sound;
    this.refresh();
  }

  setLibrary(count: number): void {
    this.library = count;
    this.refresh();
  }

  setToggles(toggles: Record<SettingToggle, boolean>): void {
    this.toggles = toggles;
    this.refresh();
  }

  private refresh(): void {
    const next = JSON.stringify([this.sound, this.library, this.toggles]);
    if (next === this.rendered) return;
    this.rendered = next;
    this.emitter.fire();
  }

  getChildren(node?: FooterNode): FooterNode[] {
    if (node !== undefined) return [];
    return [
      // First: they are about the list itself, the sounds only comment on it.
      ...SETTING_TOGGLES.map((key): FooterNode => ({ kind: 'toggle', key, on: this.toggles[key] })),
      { kind: 'sound', event: 'waiting', name: this.sound.waiting },
      { kind: 'sound', event: 'done', name: this.sound.done },
      { kind: 'volume', volume: this.sound.volume },
      { kind: 'library', count: this.library },
    ];
  }

  getTreeItem(node: FooterNode): vscode.TreeItem {
    if (node.kind === 'toggle') {
      const item = new vscode.TreeItem(toggleLabel(node.key));
      item.tooltip = toggleTooltip(node.key);
      // A real checkbox, not a word: the state is read at a glance, and the box
      // itself is a target. The row is one too — `onDidChangeCheckboxState`
      // and the command both land on the same toggle.
      item.checkboxState = node.on ? vscode.TreeItemCheckboxState.Checked : vscode.TreeItemCheckboxState.Unchecked;
      item.iconPath = new vscode.ThemeIcon(node.key === 'persistent' ? 'pin' : 'clock', new vscode.ThemeColor('descriptionForeground'));
      item.command = { command: 'kohVibe.toggleSetting', title: vscode.l10n.t('Toggle this setting'), arguments: [node.key] };
      return item;
    }
    if (node.kind === 'sound') {
      const item = new vscode.TreeItem(soundRowLabel(node.event, node.name));
      item.tooltip =
        node.event === 'waiting'
          ? vscode.l10n.t(
              'Played when a session starts waiting for your answer.\nClick to choose; the arrow keys play each sound.',
            )
          : vscode.l10n.t(
              'Played when a session has just finished.\nClick to choose; the arrow keys play each sound.',
            );
      item.iconPath = new vscode.ThemeIcon(
        node.name === NO_SOUND ? 'mute' : 'unmute',
        new vscode.ThemeColor('descriptionForeground'),
      );
      item.command = { command: 'kohVibe.chooseSound', title: EVENT_TITLE[node.event](), arguments: [node.event] };
      return item;
    }
    if (node.kind === 'volume') {
      const item = new vscode.TreeItem(volumeRowLabel(node.volume));
      item.tooltip = vscode.l10n.t('Chime volume.\nClick to set it; every step is played.');
      item.iconPath = new vscode.ThemeIcon('megaphone', new vscode.ThemeColor('descriptionForeground'));
      item.command = { command: 'kohVibe.chooseVolume', title: vscode.l10n.t('Set the volume') };
      return item;
    }
    const item = new vscode.TreeItem(libraryRowLabel(node.count));
    item.tooltip =
      node.count === 0
        ? vscode.l10n.t('A hundred short interface sounds, free of rights, downloaded once.')
        : vscode.l10n.t('Click to remove the library. Your own sounds and the system ones stay put.');
    item.iconPath = new vscode.ThemeIcon('library', new vscode.ThemeColor('descriptionForeground'));
    item.command = {
      command: node.count === 0 ? 'kohVibe.installSounds' : 'kohVibe.removeSounds',
      title: vscode.l10n.t('Sound library'),
    };
    return item;
  }

  dispose(): void {
    this.emitter.dispose();
  }
}
