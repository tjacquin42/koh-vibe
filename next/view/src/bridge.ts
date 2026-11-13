import { isHostMessage, type HostMessage, type ViewMessage } from '../../src/shared/protocol';

interface VsCodeApi {
  postMessage(message: ViewMessage): void;
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
}

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
  };
}
