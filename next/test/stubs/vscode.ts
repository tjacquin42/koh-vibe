/**
 * The slice of the `vscode` API the host touches, with just enough behaviour
 * to drive `activate()` end to end. Everything registered is recorded in
 * `recorded`, which tests read and reset.
 */

export enum ExtensionMode {
  Production = 1,
  Development = 2,
  Test = 3,
}

export enum ViewColumn {
  Active = -1,
  One = 1,
}

export class Uri {
  private constructor(readonly fsPath: string) {}
  static file(path: string): Uri {
    return new Uri(path);
  }
  static joinPath(base: Uri, ...parts: string[]): Uri {
    return new Uri([base.fsPath, ...parts].join('/'));
  }
  static parse(value: string): Uri {
    return new Uri(value);
  }
  toString(): string {
    return this.fsPath.includes('://') ? this.fsPath : `file://${this.fsPath}`;
  }
}

export enum StatusBarAlignment {
  Left = 1,
  Right = 2,
}

export class ThemeColor {
  constructor(readonly id: string) {}
}

export class FakeStatusBarItem {
  text = '';
  tooltip: string | undefined;
  command: string | undefined;
  name: string | undefined;
  backgroundColor: ThemeColor | undefined;
  visible = false;
  disposed = false;
  constructor(readonly alignment: StatusBarAlignment, readonly priority: number) {}
  show(): void {
    this.visible = true;
  }
  hide(): void {
    this.visible = false;
  }
  dispose(): void {
    this.disposed = true;
  }
}

type Listener<T> = (value: T) => unknown;

export class FakeWebview {
  html = '';
  options: unknown = {};
  readonly cspSource = 'vscode-resource:';
  readonly posted: unknown[] = [];
  private listeners: Listener<unknown>[] = [];
  postMessage(message: unknown): Promise<boolean> {
    this.posted.push(message);
    return Promise.resolve(true);
  }
  onDidReceiveMessage(listener: Listener<unknown>): { dispose(): void } {
    this.listeners.push(listener);
    return { dispose: () => (this.listeners = this.listeners.filter((l) => l !== listener)) };
  }
  /** What the page would post: resolves once every listener has finished. */
  async receive(message: unknown): Promise<void> {
    await Promise.all(this.listeners.map((l) => l(message)));
  }
  asWebviewUri(uri: Uri): Uri {
    return uri;
  }
}

export class FakeWebviewView {
  readonly webview = new FakeWebview();
  private disposeListeners: (() => void)[] = [];
  onDidDispose(listener: () => void): { dispose(): void } {
    this.disposeListeners.push(listener);
    return { dispose: () => undefined };
  }
  dispose(): void {
    for (const l of this.disposeListeners) l();
  }
}

export class FakePanel extends FakeWebviewView {
  iconPath: unknown;
  revealed = 0;
  constructor(readonly viewType: string, readonly title: string) {
    super();
  }
  reveal(): void {
    this.revealed++;
  }
}

interface ViewProvider {
  resolveWebviewView(view: FakeWebviewView): void;
}

export const recorded = {
  providers: new Map<string, ViewProvider>(),
  commands: new Map<string, (...args: unknown[]) => unknown>(),
  panels: [] as FakePanel[],
  output: [] as string[],
  statusItems: [] as FakeStatusBarItem[],
  opened: [] as string[],
  reset(): void {
    this.providers.clear();
    this.commands.clear();
    this.panels.length = 0;
    this.output.length = 0;
    this.statusItems.length = 0;
    this.opened.length = 0;
  },
};

export const window = {
  createOutputChannel(_name: string) {
    return { appendLine: (line: string) => recorded.output.push(line), dispose: () => undefined };
  },
  registerWebviewViewProvider(id: string, provider: ViewProvider) {
    recorded.providers.set(id, provider);
    return { dispose: () => recorded.providers.delete(id) };
  },
  createStatusBarItem(alignment: StatusBarAlignment, priority: number) {
    const item = new FakeStatusBarItem(alignment, priority);
    recorded.statusItems.push(item);
    return item;
  },
  createWebviewPanel(viewType: string, title: string) {
    const panel = new FakePanel(viewType, title);
    recorded.panels.push(panel);
    return panel;
  },
};

export const commands = {
  registerCommand(id: string, run: (...args: unknown[]) => unknown) {
    recorded.commands.set(id, run);
    return { dispose: () => recorded.commands.delete(id) };
  },
  getCommands(_filterInternal?: boolean): Promise<string[]> {
    return Promise.resolve([...recorded.commands.keys()]);
  },
  executeCommand(id: string, ...args: unknown[]): Promise<unknown> {
    const run = recorded.commands.get(id);
    return run === undefined ? Promise.reject(new Error(`command '${id}' not found`)) : Promise.resolve(run(...args));
  },
};

export const env = {
  language: 'fr',
  openExternal(uri: Uri): Promise<boolean> {
    recorded.opened.push(uri.toString());
    return Promise.resolve(true);
  },
};

export const workspace = { workspaceFolders: [{ uri: Uri.file('/work/open-folder') }] };

export const l10n = {
  t(message: string, ...args: unknown[]): string {
    return message.replace(/\{(\d+)\}/g, (m, i: string) => {
      const v = args[Number(i)];
      return v === undefined ? m : String(v);
    });
  },
};
