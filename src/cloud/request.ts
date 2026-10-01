import { request as httpRequest, type IncomingMessage, type RequestOptions } from 'node:http';
import { request as httpsRequest } from 'node:https';

/**
 * The one HTTP client of the extension.
 *
 * Every call Koh-Vibe makes goes to Anthropic, with the token Claude Code left
 * in the keychain, against endpoints nobody documented. One rule follows for
 * all of them: whatever goes wrong — the network, a timeout, a body too big or
 * not JSON — comes back as « nothing usable », never as an exception. Each
 * caller decides what « nothing » means for its own view.
 */
export const API_ORIGIN = 'https://api.anthropic.com';

export type Method = 'GET' | 'POST' | 'DELETE';

export interface CloudRequest {
  method: Method;
  url: string;
  headers: Readonly<Record<string, string>>;
  /** Sent as JSON when present. */
  body?: unknown;
  /**
   * What a usable answer looks like — read by the log only (cloud/log.ts),
   * which names a 2xx whose body fails it. Never changes what `send` returns:
   * deciding what an unusable body means stays with the caller.
   */
  expects?: (body: unknown) => boolean;
}

/**
 * The status, always; the body only when it parsed as JSON. A page of HTML
 * behind a 200 — a captive portal, a proxy — thus reads as a status with
 * nothing in it, which every caller already treats as unusable.
 */
export interface CloudResponse {
  status: number;
  body: unknown;
}

export type Send = (req: CloudRequest) => Promise<CloudResponse | undefined>;

export interface Limits {
  timeoutMs: number;
  maxBytes: number;
}

/**
 * Eight seconds, what the usage call always allowed. Eight megabytes: the
 * routines list weighs 422 KB for thirteen routines — each one carries its
 * whole prompt and session setup — which leaves twenty times that before
 * refusing.
 */
export const DEFAULT_LIMITS: Limits = { timeoutMs: 8_000, maxBytes: 8 * 1024 * 1024 };

export function sender(limits: Limits = DEFAULT_LIMITS): Send {
  return (req) =>
    new Promise((resolve) => {
      let settled = false;
      const done = (value: CloudResponse | undefined): void => {
        if (settled) return;
        settled = true;
        resolve(value);
      };
      let url: URL;
      try {
        url = new URL(req.url);
      } catch {
        done(undefined);
        return;
      }
      const payload = req.body === undefined ? undefined : JSON.stringify(req.body);
      const options: RequestOptions = {
        method: req.method,
        headers: {
          accept: 'application/json',
          'user-agent': 'koh-vibe',
          ...req.headers,
          ...(payload === undefined
            ? {}
            : { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(payload)) }),
        },
        timeout: limits.timeoutMs,
      };
      const onResponse = (res: IncomingMessage): void => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > limits.maxBytes) {
            // Nothing we read is that big: stop the transfer rather than buffer it.
            res.destroy();
            done(undefined);
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () =>
          done({ status: res.statusCode ?? 0, body: jsonOf(Buffer.concat(chunks).toString('utf8')) }),
        );
        res.on('error', () => done(undefined));
      };
      // `http:` only ever comes from the tests, which serve on localhost: every
      // URL the extension builds starts with API_ORIGIN.
      const call =
        url.protocol === 'http:' ? httpRequest(url, options, onResponse) : httpsRequest(url, options, onResponse);
      call.on('error', () => done(undefined));
      call.on('timeout', () => {
        call.destroy();
        done(undefined);
      });
      if (payload !== undefined) call.write(payload);
      call.end();
    });
}

/** The client the extension uses; tests build their own with `sender`. */
export const send: Send = sender();

function jsonOf(text: string): unknown {
  if (text.length === 0) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}
