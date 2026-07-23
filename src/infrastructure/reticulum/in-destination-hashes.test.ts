import { describe, expect, it } from 'vitest';
import { normalizeInDestinationHashes } from './in-destination-hashes';

describe('normalizeInDestinationHashes', () => {
  it('normalizes and sorts IN destination hashes returned by WASM', () => {
    expect(normalizeInDestinationHashes([
      new Uint8Array(16).fill(0x22),
      new Uint8Array(16).fill(0x11),
      Array(16).fill(0x22),
    ])).toEqual([
      '11'.repeat(16),
      '22'.repeat(16),
    ]);
  });

  it('rejects malformed entries at the WASM boundary', () => {
    expect(normalizeInDestinationHashes([
      null,
      new Uint8Array(15),
      'not bytes',
    ])).toEqual([]);
  });
});
