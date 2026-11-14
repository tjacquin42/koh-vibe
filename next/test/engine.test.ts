import type * as vscode from 'vscode';
import { describe, expect, it } from 'vitest';
import { engineContext, startEngine } from '../src/host/engine';

describe('the switch-over', () => {
  const ctx = { extensionPath: '/ext', subscriptions: [] } as unknown as vscode.ExtensionContext;

  it('leaves the engine to V1 while V1 is installed', async () => {
    const runs: string[] = [];
    expect(await startEngine(ctx, { installed: () => true, run: async () => void runs.push('run') }, () => undefined)).toBe('v1');
    expect(runs).toEqual([]);
  });

  it('runs it once V1 is gone, and says so when it cannot', async () => {
    const runs: string[] = [];
    const log: string[] = [];
    expect(await startEngine(ctx, { installed: () => false, run: async () => void runs.push('run') }, (l) => log.push(l))).toBe('started');
    expect(runs).toEqual(['run']);
    expect(await startEngine(ctx, { installed: () => false, run: () => Promise.reject(new Error('boom')) }, (l) => log.push(l))).toBe('failed');
    expect(log.at(-1)).toContain('boom');
  });

  it('gives the engine engine/ as the extension folder, the rest untouched', () => {
    const seen = engineContext(ctx);
    expect(seen.extensionPath).toBe('/ext/engine');
    expect(seen.subscriptions).toBe(ctx.subscriptions);
  });
});
