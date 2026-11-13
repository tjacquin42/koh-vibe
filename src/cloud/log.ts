import { isRecord } from '../lib/json';
import type { CloudRequest, CloudResponse, Send } from './request';

/**
 * One line for a cloud call that did not go through: when, the method, the
 * path, and what came back. Never a header — the token travels there — never
 * a body, which can quote a prompt, and never the query. The one exception is
 * the reason the API gives for a refusal (`reasonOf`): its own words about the
 * call, without which a 400 says nothing of what to fix.
 *
 * `undefined` for a call that went fine: a 2xx, with a JSON body when one was
 * asked for, of the shape the caller said it reads (`expects`). A GET that
 * comes back 200 with something that is not JSON — a captive portal, a proxy's
 * page — is a failure too, and the most puzzling one to diagnose without this
 * line.
 */
export function failureLine(req: CloudRequest, res: CloudResponse | undefined, at: number): string | undefined {
  let outcome: string;
  if (res === undefined) outcome = 'no answer';
  else if (res.status < 200 || res.status >= 300) outcome = `HTTP ${res.status}${reasonOf(res.body)}`;
  else if (req.method === 'GET' && res.body === undefined) outcome = `HTTP ${res.status}, not JSON`;
  // JSON, but not the shape the caller reads: the likeliest way an
  // undocumented endpoint changes, and the quietest without this line.
  else if (req.expects !== undefined && !req.expects(res.body)) outcome = `HTTP ${res.status}, unexpected shape`;
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

const REASON_MAX = 160;

/**
 * The type and the message of the API's error envelope
 * (`{ error: { type, message } }`), folded onto one line and cut short — or
 * nothing, for any other body: no other field is ever read.
 */
function reasonOf(body: unknown): string {
  if (!isRecord(body)) return '';
  const error = body['error'];
  if (!isRecord(error)) return '';
  const parts = [error['type'], error['message']]
    .filter((p): p is string => typeof p === 'string')
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter((p) => p.length > 0);
  if (parts.length === 0) return '';
  const reason = parts.join(': ');
  return ` (${reason.length > REASON_MAX ? `${reason.slice(0, REASON_MAX - 1)}…` : reason})`;
}

function pathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}
