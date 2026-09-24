// Minimal stub of the `vscode` API, used only in tests (vitest alias, see
// vitest.config.ts: `vscode` resolves to this file rather than to the real
// module, which only exists inside the extension host).
//
// Covers exactly what `FocusBroker` and `SessionsTree` need to be tested
// without launching VSCode — to be extended as a real need arises, never
// ahead of one. `getTreeItem` (which builds `TreeItem`, `ThemeIcon`,
// `ThemeColor`) is not exercised by the current tests; these classes are
// still provided, minimal, so that the module importing them stays loadable.

export class EventEmitter<T> {
  private listeners: Array<(e: T) => void> = [];

  event = (listener: (e: T) => void): { dispose: () => void } => {
    this.listeners.push(listener);
    return {
      dispose: (): void => {
        this.listeners = this.listeners.filter((l) => l !== listener);
      },
    };
  };

  fire(e: T): void {
    for (const listener of this.listeners) listener(e);
  }

  dispose(): void {
    this.listeners = [];
  }
}

export enum TreeItemCollapsibleState {
  None = 0,
  Collapsed = 1,
  Expanded = 2,
}

/**
 * Faithful enough for what the view does with it: `Uri.from` keeps the
 * fields and `toString` recomposes them. The stub does not try to reproduce
 * VSCode's full encoding — the tests target what the tree SETS, and reading
 * the URI back is proven separately, on a pure function (ui/decorations.ts).
 */
export class Uri {
  private constructor(
    public readonly scheme: string,
    public readonly authority: string,
    public readonly path: string,
    public readonly query: string,
  ) {}

  static from(parts: { scheme: string; authority?: string; path?: string; query?: string }): Uri {
    return new Uri(parts.scheme, parts.authority ?? '', parts.path ?? '', parts.query ?? '');
  }

  /** What SessionsTree calls for its status badges. */
  static file(path: string): Uri {
    return new Uri('file', '', path, '');
  }

  get fsPath(): string {
    return this.path;
  }

  toString(): string {
    return `${this.scheme}://${this.authority}${this.path}?${this.query}`;
  }
}

export class ThemeColor {
  constructor(public readonly id: string) {}
}

export class ThemeIcon {
  constructor(
    public readonly id: string,
    public readonly color?: ThemeColor,
  ) {}
}

export enum TreeItemCheckboxState {
  Unchecked = 0,
  Checked = 1,
}

export interface TreeItemCommand {
  command: string;
  title: string;
  arguments?: unknown[];
}

export class TreeItem {
  description?: string;
  tooltip?: string;
  contextValue?: string;
  accessibilityInformation?: { label: string };
  iconPath?: unknown;
  command?: TreeItemCommand;
  checkboxState?: TreeItemCheckboxState;

  constructor(
    public readonly label: string,
    public readonly collapsibleState?: TreeItemCollapsibleState,
  ) {}
}

/**
 * Translation, stubbed to the identity.
 *
 * `vscode.l10n.t` returns the source string whenever the running editor has no
 * bundle for its language — which is exactly what happens in English, the
 * language the sources are written in. Tests therefore assert the English
 * strings, and they assert them through the same call the extension makes.
 */
/**
 * The editor's DISPLAY language, which is what date and time formats follow.
 * English here, like `l10n` above: the tests assert the English rendering
 * through the same call the extension makes.
 */
export const env = { language: 'en' };

export const l10n = {
  t(message: string, ...args: Array<string | number>): string {
    return message.replace(/\{(\d+)\}/g, (whole, index: string) => {
      const value = args[Number(index)];
      return value === undefined ? whole : String(value);
    });
  },
};

export interface StubTerminal {
  sendText: (text: string) => void;
  show: () => void;
}

/**
 * A webview tab's input, as the real API exposes it. Only `viewType` matters
 * here: a Claude Code panel is created as `claudeVSCodePanel`, and VSCode
 * prefixes it (`mainThreadWebview-claudeVSCodePanel`), hence the substring
 * test rather than an equality — the same test the Claude Code bundle uses on
 * its own tabs.
 */
export class TabInputWebview {
  constructor(public readonly viewType: string) {}
}

export interface StubTab {
  /** `unknown` like `DataTransferItem.value`: whoever reads it must narrow it. */
  input: unknown;
}

export interface StubTabGroup {
  tabs: StubTab[];
  activeTab: StubTab | undefined;
}

export const tabChange = new EventEmitter<void>();

export const stubTabGroups: {
  all: StubTabGroup[];
  activeTabGroup: StubTabGroup;
  onDidChangeTabs: (listener: () => void) => { dispose: () => void };
  close: (tab: StubTab) => Promise<boolean>;
} = {
  all: [],
  activeTabGroup: { tabs: [], activeTab: undefined },
  onDidChangeTabs: (listener) => tabChange.event(listener),
  close: async (): Promise<boolean> => true,
};

export enum StatusBarAlignment {
  Left = 1,
  Right = 2,
}

/** What `StatusSummary` sets on its item, kept so a test can read it back. */
export interface StubStatusBarItem {
  command?: string;
  name?: string;
  text?: string;
  tooltip?: string;
  backgroundColor?: ThemeColor;
  visible: boolean;
  show: () => void;
  hide: () => void;
  dispose: () => void;
}

/** Every status bar item created so far, newest last. */
export const statusBarItems: StubStatusBarItem[] = [];

export const window = {
  createStatusBarItem: (_alignment?: StatusBarAlignment, _priority?: number): StubStatusBarItem => {
    const item: StubStatusBarItem = {
      visible: false,
      show: () => {
        item.visible = true;
      },
      hide: () => {
        item.visible = false;
      },
      dispose: () => undefined,
    };
    statusBarItems.push(item);
    return item;
  },
  showInformationMessage: async (..._args: unknown[]): Promise<string | undefined> => undefined,
  showWarningMessage: async (..._args: unknown[]): Promise<string | undefined> => undefined,
  showErrorMessage: async (..._args: unknown[]): Promise<string | undefined> => undefined,
  createTreeView: (..._args: unknown[]): never => {
    throw new Error('vscode.window.createTreeView non bouchonné');
  },
  // Made observable rather than fatal: reopening a terminal conversation
  // depends on it, and a test has to be able to check WHAT is sent.
  createTerminal: (_options: { cwd?: string; name?: string }): StubTerminal => ({
    sendText: () => undefined,
    show: () => undefined,
  }),
  tabGroups: stubTabGroups,
};

export const workspace: { workspaceFolders: Array<{ uri: { fsPath: string } }> | undefined } = {
  workspaceFolders: undefined,
};

export const commands = {
  executeCommand: async (..._args: unknown[]): Promise<unknown> => undefined,
  registerCommand: (..._args: unknown[]): { dispose: () => void } => ({ dispose: () => undefined }),
};

// Covers exactly what SessionsTree.handleDrag/handleDrop need: setting a
// value under a MIME type, reading it back under that same type. `value` is
// typed `unknown` (the real API declares it `any`) so that the code reading
// it is forced to validate it before use, never to cast it.
export class DataTransferItem {
  constructor(public readonly value: unknown) {}
}

export class DataTransfer {
  private readonly items = new Map<string, DataTransferItem>();

  get(mimeType: string): DataTransferItem | undefined {
    return this.items.get(mimeType);
  }

  set(mimeType: string, item: DataTransferItem): void {
    this.items.set(mimeType, item);
  }
}
