/** What is being dragged in the Sessions tab: a conversation, a folder by its heading, or an artifact out of the folder `from`. */
export type Drag = { kind: 'session'; id: string } | { kind: 'folder'; id: string } | { kind: 'artifact'; slug: string; title: string; from: string };

export interface Dnd {
  drag: Drag | undefined;
  setDrag(d: Drag | undefined): void;
  /** The artifact just dropped on another folder, by slug, for the little motion that shows where it landed; `undefined` once shown, or with animations off. */
  landed: string | undefined;
  land(slug: string): void;
}
