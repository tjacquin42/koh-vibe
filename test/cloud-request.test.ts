import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { sender } from '../src/cloud/request';
import { fetchUsage } from '../src/usage/oauth';

type Handler = (req: IncomingMessage, body: string, res: ServerResponse) => void;

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (s) =>
        new Promise<void>((resolve) => {
          s.closeAllConnections();
          s.close(() => resolve());
        }),
    ),
  );
});

/** A local server answering through `handler`, and its base URL. */
async function serve(handler: Handler): Promise<string> {
  const server = createServer((req, res) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk: string) => {
      body += chunk;
    });
    req.on('end', () => handler(req, body, res));
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

const send = sender({ timeoutMs: 300, maxBytes: 1024 });

describe('the cloud client', () => {
  it('returns the status and the parsed body', async () => {
    const base = await serve((_req, _body, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"a":1}');
    });
    expect(await send({ method: 'GET', url: `${base}/x`, headers: {} })).toEqual({ status: 200, body: { a: 1 } });
  });

  it('sends the headers it is given, and a JSON body with its type', async () => {
    let seen: Record<string, string | undefined> = {};
    const base = await serve((req, body, res) => {
      seen = {
        method: req.method,
        auth: req.headers['authorization'],
        type: req.headers['content-type'],
        body,
      };
      res.writeHead(204);
      res.end();
    });
    const answer = await send({
      method: 'POST',
      url: `${base}/x`,
      headers: { authorization: 'Bearer tok' },
      body: { enabled: false },
    });
    expect(answer).toEqual({ status: 204, body: undefined });
    expect(seen).toEqual({ method: 'POST', auth: 'Bearer tok', type: 'application/json', body: '{"enabled":false}' });
  });

  it('keeps the status of a failure, with no body to trust', async () => {
    const base = await serve((_req, _body, res) => {
      res.writeHead(500);
      res.end('<html>oops</html>');
    });
    expect(await send({ method: 'GET', url: base, headers: {} })).toEqual({ status: 500, body: undefined });
  });

  it('reads a 200 that is not JSON — a captive portal, a proxy page — as a status with nothing in it', async () => {
    const base = await serve((_req, _body, res) => {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<html>portal</html>');
    });
    expect(await send({ method: 'GET', url: base, headers: {} })).toEqual({ status: 200, body: undefined });
  });

  it('gives up on a server that never answers', async () => {
    const base = await serve(() => undefined);
    expect(await send({ method: 'GET', url: base, headers: {} })).toBeUndefined();
  });

  it('drops a body larger than the limit rather than buffering it', async () => {
    const base = await serve((_req, _body, res) => {
      res.writeHead(200);
      res.end(JSON.stringify({ big: 'x'.repeat(4096) }));
    });
    expect(await send({ method: 'GET', url: base, headers: {} })).toBeUndefined();
  });

  it('answers undefined when nothing listens, or for a URL it cannot parse', async () => {
    expect(await send({ method: 'GET', url: 'http://127.0.0.1:1/', headers: {} })).toBeUndefined();
    expect(await send({ method: 'GET', url: 'not a url', headers: {} })).toBeUndefined();
  });
});

describe('fetchUsage, on the shared client', () => {
  it('sends the token and the OAuth beta, and returns the body of a 200', async () => {
    let seen: Record<string, string | string[] | undefined> = {};
    const base = await serve((req, _body, res) => {
      seen = req.headers;
      res.writeHead(200);
      res.end('{"five_hour":{"utilization":5}}');
    });
    expect(await fetchUsage('tok', `${base}/api/oauth/usage`)).toEqual({ five_hour: { utilization: 5 } });
    expect(seen['authorization']).toBe('Bearer tok');
    expect(seen['anthropic-beta']).toBe('oauth-2025-04-20');
  });

  it('returns undefined for anything but a 200', async () => {
    const base = await serve((_req, _body, res) => {
      res.writeHead(401);
      res.end('{}');
    });
    expect(await fetchUsage('tok', base)).toBeUndefined();
  });
});
