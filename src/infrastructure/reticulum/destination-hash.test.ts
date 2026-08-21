import { describe, expect, it } from 'vitest';
import {
  destinationHashFromIdentity,
  normalizeFullDestinationName,
} from './destination-hash';

describe('Reticulum destination hash derivation', () => {
  it('matches the Reticulum reference derivation from identity hash and full name', async () => {
    const identityHash = 'fdeab9acf3710362bd2658cdc9a29e8f';

    await expect(destinationHashFromIdentity(identityHash, 'audit.kat.field'))
      .resolves.toBe('f000a6e0bcdb026f6dbc6eed918fab21');
  });

  it('normalizes valid input and rejects malformed hash or name material', async () => {
    expect(normalizeFullDestinationName('  lxmf.delivery  ')).toBe('lxmf.delivery');
    expect(normalizeFullDestinationName('lxmf..delivery')).toBeUndefined();
    expect(normalizeFullDestinationName('')).toBeUndefined();
    await expect(destinationHashFromIdentity('not-a-hash', 'lxmf.delivery'))
      .resolves.toBeUndefined();
    await expect(destinationHashFromIdentity('a'.repeat(32), '.lxmf.delivery'))
      .resolves.toBeUndefined();
  });
});
