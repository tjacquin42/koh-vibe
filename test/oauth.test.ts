import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import type { ClientRequest, IncomingMessage } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchUsage, readAccessToken } from '../src/usage/oauth';

// Both native calls are replaced outright, with no passthrough to the real
// implementation (unlike the `node:fs/promises` mock in watcher.test.ts):
// there is no scenario here where falling through to the real `security`
// binary or a real HTTPS request would be a reading worth taking in a test —
// only a bug would make that happen, and a passthrough default would hide
// it behind a call that quietly succeeds or hangs instead of failing loudly.
//
// The handles are read directly off `vi.hoisted`, never through
// `vi.mocked(execFile)`: `execFile`'s type is a long overload chain, and
// matching a hand-written implementation against the right member of it
// fights the compiler for no benefit a plain, loosely-typed mock doesn't
// already give the test.
const { execFileMock, requestMock } = vi.hoisted(() => ({ execFileMock: vi.fn(), requestMock: vi.fn() }));
vi.mock('node:child_process', () => ({ execFile: execFileMock }));
vi.mock('node:https', () => ({ request: requestMock }));

type ExecFileCallback = (error: Error | null, stdout: string, stderr: string) => void;

/** A `ClientRequest` faithful enough for `fetchUsage`: `on`, `end`, `destroy`. */
function fakeClientRequest(): EventEmitter & { end: () => void; destroy: () => void } {
  const req = new EventEmitter() as EventEmitter & { end: () => void; destroy: () => void };
  req.end = vi.fn();
  req.destroy = vi.fn();
  return req;
}

/** An `IncomingMessage` faithful enough for `fetchUsage`: `statusCode`, `resume`, `setEncoding`, `on`. */
function fakeIncomingMessage(statusCode: number): EventEmitter & {
  statusCode: number;
  resume: () => void;
  setEncoding: () => void;
} {
  const res = new EventEmitter() as EventEmitter & {
    statusCode: number;
    resume: () => void;
    setEncoding: () => void;
  };
  res.statusCode = statusCode;
  res.resume = vi.fn();
  res.setEncoding = vi.fn();
  return res;
}

describe('readAccessToken', () => {
  afterEach(() => {
    execFileMock.mockReset();
  });

  it('asks the keychain for the Claude Code credentials, over execFile rather than a shell', async () => {
    execFileMock.mockImplementation((command: string, args: readonly string[], callback: ExecFileCallback) => {
      expect(command).toBe('/usr/bin/security');
      expect(args).toEqual(['find-generic-password', '-s', 'Claude Code-credentials', '-w']);
      callback(null, JSON.stringify({ claudeAiOauth: { accessToken: 'le-jeton' } }), '');
      return {} as ChildProcess;
    });
    await expect(readAccessToken()).resolves.toBe('le-jeton');
  });

  it('resolves to undefined, never a rejection, when the keychain refuses (locked, denied)', async () => {
    execFileMock.mockImplementation((_command: string, _args: readonly string[], callback: ExecFileCallback) => {
      callback(new Error('User interaction is not allowed.'), '', '');
      return {} as ChildProcess;
    });
    await expect(readAccessToken()).resolves.toBeUndefined();
  });

  it('resolves to undefined when the keychain answers with something unusable', async () => {
    execFileMock.mockImplementation((_command: string, _args: readonly string[], callback: ExecFileCallback) => {
      callback(null, 'not the expected JSON', '');
      return {} as ChildProcess;
    });
    await expect(readAccessToken()).resolves.toBeUndefined();
  });
});

describe('fetchUsage', () => {
  afterEach(() => {
    requestMock.mockReset();
  });

  it('sends the bearer token and the beta header, to the default usage URL', async () => {
    requestMock.mockImplementation((url: string, options: unknown, onResponse: (res: IncomingMessage) => void) => {
      expect(url).toBe('https://api.anthropic.com/api/oauth/usage');
      expect(options).toMatchObject({
        method: 'GET',
        headers: {
          authorization: 'Bearer le-jeton',
          'anthropic-beta': 'oauth-2025-04-20',
          accept: 'application/json',
        },
      });
      const req = fakeClientRequest();
      const res = fakeIncomingMessage(200);
      queueMicrotask(() => {
        onResponse(res as unknown as IncomingMessage);
        res.emit('data', '{"rate_limits":{}}');
        res.emit('end');
      });
      return req as unknown as ClientRequest;
    });
    await expect(fetchUsage('le-jeton')).resolves.toEqual({ rate_limits: {} });
  });

  it('reassembles a body delivered in several chunks', async () => {
    requestMock.mockImplementation((_url: string, _options: unknown, onResponse: (res: IncomingMessage) => void) => {
      const req = fakeClientRequest();
      const res = fakeIncomingMessage(200);
      queueMicrotask(() => {
        onResponse(res as unknown as IncomingMessage);
        res.emit('data', '{"rate_l');
        res.emit('data', 'imits":{"five_hour":{}}}');
        res.emit('end');
      });
      return req as unknown as ClientRequest;
    });
    await expect(fetchUsage('le-jeton')).resolves.toEqual({ rate_limits: { five_hour: {} } });
  });

  it('queries a custom URL when one is given, rather than the default', async () => {
    requestMock.mockImplementation((url: string, _options: unknown, onResponse: (res: IncomingMessage) => void) => {
      expect(url).toBe('https://example.test/usage');
      const req = fakeClientRequest();
      const res = fakeIncomingMessage(200);
      queueMicrotask(() => {
        onResponse(res as unknown as IncomingMessage);
        res.emit('data', '{}');
        res.emit('end');
      });
      return req as unknown as ClientRequest;
    });
    await fetchUsage('le-jeton', 'https://example.test/usage');
  });

  it('drains and discards a non-200 response, rather than parsing its body', async () => {
    requestMock.mockImplementation((_url: string, _options: unknown, onResponse: (res: IncomingMessage) => void) => {
      const req = fakeClientRequest();
      const res = fakeIncomingMessage(401);
      queueMicrotask(() => onResponse(res as unknown as IncomingMessage));
      return req as unknown as ClientRequest;
    });
    await expect(fetchUsage('jeton-expire')).resolves.toBeUndefined();
  });

  it('resolves to undefined on a body that is not valid JSON', async () => {
    requestMock.mockImplementation((_url: string, _options: unknown, onResponse: (res: IncomingMessage) => void) => {
      const req = fakeClientRequest();
      const res = fakeIncomingMessage(200);
      queueMicrotask(() => {
        onResponse(res as unknown as IncomingMessage);
        res.emit('data', 'this is not JSON');
        res.emit('end');
      });
      return req as unknown as ClientRequest;
    });
    await expect(fetchUsage('le-jeton')).resolves.toBeUndefined();
  });

  it('resolves to undefined on a network error, without the response ever answering', async () => {
    requestMock.mockImplementation(() => {
      const req = fakeClientRequest();
      queueMicrotask(() => req.emit('error', new Error('getaddrinfo ENOTFOUND')));
      return req as unknown as ClientRequest;
    });
    await expect(fetchUsage('le-jeton')).resolves.toBeUndefined();
  });

  it('destroys the request and resolves to undefined on a timeout', async () => {
    let req!: ReturnType<typeof fakeClientRequest>;
    requestMock.mockImplementation(() => {
      req = fakeClientRequest();
      queueMicrotask(() => req.emit('timeout'));
      return req as unknown as ClientRequest;
    });
    await expect(fetchUsage('le-jeton')).resolves.toBeUndefined();
    expect(req.destroy).toHaveBeenCalled();
  });

  it('always ends the request it opened', async () => {
    let req!: ReturnType<typeof fakeClientRequest>;
    requestMock.mockImplementation((_url: string, _options: unknown, onResponse: (res: IncomingMessage) => void) => {
      req = fakeClientRequest();
      const res = fakeIncomingMessage(200);
      queueMicrotask(() => {
        onResponse(res as unknown as IncomingMessage);
        res.emit('data', '{}');
        res.emit('end');
      });
      return req as unknown as ClientRequest;
    });
    await fetchUsage('le-jeton');
    expect(req.end).toHaveBeenCalled();
  });
});
