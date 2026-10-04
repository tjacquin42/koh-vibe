/**
 * `Object.keys` with the keys it actually has. The built-in returns
 * `string[]` whatever the record, which is right in general — an object may
 * carry keys its type does not name — and wrong for a record built here as a
 * closed table, where the keys ARE the type.
 */
export function keysOf<K extends string>(record: Readonly<Record<K, unknown>>): K[] {
  return Object.keys(record) as K[];
}
