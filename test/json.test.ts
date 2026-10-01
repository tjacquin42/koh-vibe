import { describe, expect, it } from 'vitest';
import { foldedText, isRecord, isoTimeOf, nonEmptyString } from '../src/lib/json';

describe('isRecord', () => {
  it('accepts an object and nothing else JSON can hold', () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord({ a: 1 })).toBe(true);
    for (const other of [[], null, 'x', 1, true, undefined]) expect(isRecord(other)).toBe(false);
  });
});

describe('nonEmptyString', () => {
  it('reads an empty string as absent, like anything that is not a string', () => {
    expect(nonEmptyString('x')).toBe('x');
    for (const other of ['', 7, null, undefined, ['x']]) expect(nonEmptyString(other)).toBeUndefined();
  });
});

describe('isoTimeOf', () => {
  it('reads an ISO date, nanoseconds and all', () => {
    expect(isoTimeOf('2026-09-28T06:08:45.819628769Z')).toBe(Date.parse('2026-09-28T06:08:45.819Z'));
  });

  it('reads anything else as no date', () => {
    for (const v of ['', 'soon', null, undefined, 1790575725819]) expect(isoTimeOf(v)).toBeUndefined();
  });
});

describe('foldedText', () => {
  it('folds whitespace, newlines included, and trims the ends', () => {
    expect(foldedText('  Morning\n  digest\t ')).toBe('Morning digest');
  });

  it('reads anything but a string as empty', () => {
    expect(foldedText(42)).toBe('');
    expect(foldedText(undefined)).toBe('');
  });
});
