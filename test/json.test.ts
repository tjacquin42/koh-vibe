import { describe, expect, it } from 'vitest';
import { isRecord, nonEmptyString } from '../src/lib/json';

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
