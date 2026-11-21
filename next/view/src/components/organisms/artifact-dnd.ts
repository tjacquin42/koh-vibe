/** An artifact being carried in the Artifacts tab, and the project it leaves — `undefined` for « Other ». */
export interface ArtifactDrag {
  slug: string;
  project: string | undefined;
}

/**
 * Moving artifacts between projects by dragging them (16/11), handed by the
 * tab to its rows, its projects and « New project ».
 */
export interface ArtifactDnd {
  drag: ArtifactDrag | undefined;
  setDrag(d: ArtifactDrag | undefined): void;
  /** Files it under `project` — `null` for « Other » — and marks where it lands. */
  file(d: ArtifactDrag, project: string | null): void;
  /** The artifact that just landed, for the little motion that shows where; `undefined` once shown, or with animations off. */
  landed: ArtifactDrag | undefined;
  /** A project dragged by its heading to another place (21/11), by name. */
  moving: string | undefined;
  setMoving(name: string | undefined): void;
  /** Puts it on `target`'s `after` side — at the end with no `target`. */
  place(name: string, target: string | undefined, after: boolean): void;
}
