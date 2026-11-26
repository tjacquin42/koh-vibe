import { isHostMessage, type HostMessage, type ViewMessage } from '../../src/shared/protocol';

interface VsCodeApi {
  postMessage(message: ViewMessage): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare global {
  // Injected by VSCode into every web view, callable once.
  function acquireVsCodeApi(): VsCodeApi;
}

export interface Bridge {
  /** False when the page is opened straight from Vite in a browser. */
  readonly inEditor: boolean;
  post(message: ViewMessage): void;
  /** Returns the unsubscribe function. */
  listen(onMessage: (message: HostMessage) => void): () => void;
  /** The view's own memory: VSCode's per-view state, or localStorage in the browser preview. */
  load(): unknown;
  save(state: unknown): void;
}

const PREVIEW_KEY = 'koh-vibe-next.ui';

export function createBridge(): Bridge {
  const api: VsCodeApi | undefined = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : undefined;
  return {
    inEditor: api !== undefined,
    post(message) {
      api?.postMessage(message);
    },
    listen(onMessage) {
      const handler = (event: MessageEvent<unknown>): void => {
        if (isHostMessage(event.data)) onMessage(event.data);
      };
      window.addEventListener('message', handler);
      return () => window.removeEventListener('message', handler);
    },
    load() {
      if (api !== undefined) return api.getState();
      try {
        const raw = window.localStorage.getItem(PREVIEW_KEY);
        return raw === null ? undefined : (JSON.parse(raw) as unknown);
      } catch {
        return undefined;
      }
    },
    save(state) {
      if (api !== undefined) {
        api.setState(state);
        return;
      }
      try {
        window.localStorage.setItem(PREVIEW_KEY, JSON.stringify(state));
      } catch {
        // Private window or blocked storage: the preview just forgets.
      }
    },
  };
}
