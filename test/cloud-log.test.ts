import { describe, expect, it } from 'vitest';
import { failureLine, logged } from '../src/cloud/log';
import type { CloudRequest, CloudResponse } from '../src/cloud/request';

const AT = Date.UTC(2026, 8, 28, 6, 0, 0);

const req = (method: 'GET' | 'POST'): CloudRequest => ({
  method,
  url: 'https://api.anthropic.com/v1/code/triggers?limit=5',
  headers: { authorization: 'Bearer secret-token' },
  body: { prompt: 'secret prompt' },
});

describe('failureLine', () => {
  it('says nothing about a call that went through', () => {
    expect(failureLine(req('GET'), { status: 200, body: { data: [] } }, AT)).toBeUndefined();
    expect(failureLine(req('POST'), { status: 204, body: undefined }, AT)).toBeUndefined();
  });

  it('writes the method, the path and the outcome of one that did not', () => {
    expect(failureLine(req('POST'), { status: 404, body: { error: 'x' } }, AT)).toBe(
      '2026-09-28T06:00:00.000Z POST /v1/code/triggers → HTTP 404',
    );
    expect(failureLine(req('GET'), undefined, AT)).toBe('2026-09-28T06:00:00.000Z GET /v1/code/triggers → no answer');
    expect(failureLine(req('GET'), { status: 200, body: undefined }, AT)).toBe(
      '2026-09-28T06:00:00.000Z GET /v1/code/triggers → HTTP 200, not JSON',
    );
  });

  it('never writes the token, the body or the query', () => {
    const line = failureLine(req('POST'), { status: 500, body: undefined }, AT) ?? '';
    expect(line).not.toContain('secret');
    expect(line).not.toContain('limit');
  });
});

describe('logged', () => {
  it('passes every answer through, and writes a line only for a failure', async () => {
    const lines: string[] = [];
    const answers: Array<CloudResponse | undefined> = [{ status: 200, body: {} }, { status: 401, body: undefined }];
    let i = 0;
    const send = logged(
      async () => answers[i++],
      (line) => lines.push(line),
      () => AT,
    );
    expect(await send(req('GET'))).toEqual({ status: 200, body: {} });
    expect(await send(req('GET'))).toEqual({ status: 401, body: undefined });
    expect(lines).toEqual(['2026-09-28T06:00:00.000Z GET /v1/code/triggers → HTTP 401']);
  });
});

describe('failureLine, on what the caller reads', () => {
  const listing = (): CloudRequest => ({
    method: 'GET',
    url: 'https://api.anthropic.com/v1/code/triggers',
    headers: {},
    expects: (body) => typeof body === 'object' && body !== null && Array.isArray((body as { data?: unknown }).data),
  });

  it('names a 200 whose body is not what the caller reads — the likeliest way an undocumented endpoint breaks', () => {
    expect(failureLine(listing(), { status: 200, body: { items: [] } }, AT)).toBe(
      '2026-09-28T06:00:00.000Z GET /v1/code/triggers → HTTP 200, unexpected shape',
    );
  });

  it('says nothing when the body is what the caller reads', () => {
    expect(failureLine(listing(), { status: 200, body: { data: [] } }, AT)).toBeUndefined();
  });
});
