import type { CloudRequest, CloudResponse, Send } from './request';

/**
 * One line for a cloud call that did not go through: when, the method, the
 * path, and what came back. Never a header — the token travels there — never
 * a body, which can quote a prompt, and never the query.
 *
 * `undefined` for a call that went fine: a 2xx, with a JSON body when one was
 * asked for. A GET that comes back 200 with something that is not JSON — a
 * captive portal, a proxy's page — is a failure too, and the most puzzling one
 * to diagnose without this line.
 */
export function failureLine(req: CloudRequest, res: CloudResponse | undefined, at: number): string | undefined {
  let outcome: string;
  if (res === undefined) outcome = 'no answer';
  else if (res.status < 200 || res.status >= 300) outcome = `HTTP ${res.status}`;
  else if (req.method === 'GET' && res.body === undefined) outcome = `HTTP ${res.status}, not JSON`;
  else return undefined;
  return `${new Date(at).toISOString()} ${req.method} ${pathOf(req.url)} → ${outcome}`;
}

/** `inner`, with every failed call written down. */
export function logged(inner: Send, write: (line: string) => void, now: () => number = () => Date.now()): Send {
  return async (req) => {
    const res = await inner(req);
    const line = failureLine(req, res, now());
    if (line !== undefined) write(line);
    return res;
  };
}

function pathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}
