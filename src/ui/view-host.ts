import * as vscode from 'vscode';

/**
 * Where the extension's views live. In the editor's window, as always; or
 * nowhere, when Koh-Vibe 2 runs this extension's engine under its own web
 * views (the switch-over): the spool is drained, the sessions written, the
 * sounds played and every command registered exactly as before, but none of
 * the old tree views is shown.
 *
 * A view that is nowhere is never visible, so whatever the extension does only
 * for an open view — a process scan, a reveal, a call to claude.ai — simply
 * does not happen.
 */
export interface ViewHost {
  createTreeView<T>(viewId: string, options: vscode.TreeViewOptions<T>): vscode.TreeView<T>;
  registerWebviewViewProvider(viewId: string, provider: vscode.WebviewViewProvider): vscode.Disposable;
  /** A progress bar over a view, around `task`. */
  withViewProgress<R>(viewId: string, task: () => Thenable<R>): Thenable<R>;
  createStatusBarItem(alignment: vscode.StatusBarAlignment, priority: number): vscode.StatusBarItem;
}

export const editorViews: ViewHost = {
  createTreeView: (viewId, options) => vscode.window.createTreeView(viewId, options),
  registerWebviewViewProvider: (viewId, provider) => vscode.window.registerWebviewViewProvider(viewId, provider),
  withViewProgress: (viewId, task) => vscode.window.withProgress({ location: { viewId } }, task),
  createStatusBarItem: (alignment, priority) => vscode.window.createStatusBarItem(alignment, priority),
};

/** A tree view that is never shown: its events never fire, a reveal does nothing. */
function hiddenTreeView<T>(): vscode.TreeView<T> {
  const never = <E>(): vscode.EventEmitter<E> => new vscode.EventEmitter<E>();
  const emitters = {
    expand: never<vscode.TreeViewExpansionEvent<T>>(),
    collapse: never<vscode.TreeViewExpansionEvent<T>>(),
    selection: never<vscode.TreeViewSelectionChangeEvent<T>>(),
    checkbox: never<vscode.TreeCheckboxChangeEvent<T>>(),
    visibility: never<vscode.TreeViewVisibilityChangeEvent>(),
  };
  return {
    onDidExpandElement: emitters.expand.event,
    onDidCollapseElement: emitters.collapse.event,
    selection: [],
    onDidChangeSelection: emitters.selection.event,
    onDidChangeCheckboxState: emitters.checkbox.event,
    visible: false,
    onDidChangeVisibility: emitters.visibility.event,
    message: undefined,
    title: undefined,
    description: undefined,
    badge: undefined,
    reveal: () => Promise.resolve(),
    dispose: () => {
      for (const e of Object.values(emitters)) e.dispose();
    },
  };
}

/** A status bar item that is never shown: Koh-Vibe 2 has its own. */
function hiddenStatusBarItem(alignment: vscode.StatusBarAlignment, priority: number): vscode.StatusBarItem {
  return {
    id: 'kohVibe.hidden',
    alignment,
    priority,
    name: undefined,
    text: '',
    tooltip: undefined,
    color: undefined,
    backgroundColor: undefined,
    command: undefined,
    accessibilityInformation: undefined,
    show: () => undefined,
    hide: () => undefined,
    dispose: () => undefined,
  };
}

export const noViews: ViewHost = {
  createTreeView: () => hiddenTreeView(),
  registerWebviewViewProvider: () => ({ dispose: () => undefined }),
  withViewProgress: (_viewId, task) => task(),
  createStatusBarItem: (alignment, priority) => hiddenStatusBarItem(alignment, priority),
};
