import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type * as vscode from 'vscode';
import { describe, expect, it } from 'vitest';
import { engineContext, startEngine } from '../src/host/engine';
import { interfaceOf } from '../src/host/main';

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

  it('gives the engine engine/ as its folder when the package has one, the root otherwise, the rest untouched', () => {
    const root = mkdtempSync(join(tmpdir(), 'kvn-engine-'));
    try {
      const at = (path: string) => ({ extensionPath: path, subscriptions: [] }) as unknown as vscode.ExtensionContext;
      // 2.0's package: V1's files at the root.
      expect(engineContext(at(root)).extensionPath).toBe(root);
      // Koh-Vibe Next's own package: gathered in engine/.
      mkdirSync(join(root, 'engine'));
      const next = at(root);
      expect(engineContext(next).extensionPath).toBe(join(root, 'engine'));
      expect(engineContext(next).subscriptions).toBe(next.subscriptions);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('the interface', () => {
  it('is the new one unless the settings say classic', () => {
    const with_ = (v: unknown) => ({ get: () => v });
    expect(interfaceOf(with_(undefined))).toBe('new');
    expect(interfaceOf(with_('new'))).toBe('new');
    expect(interfaceOf(with_('classic'))).toBe('classic');
    expect(interfaceOf(with_('v1'))).toBe('new');
  });
});

