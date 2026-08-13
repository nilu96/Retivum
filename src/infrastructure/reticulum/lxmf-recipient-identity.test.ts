import { describe, expect, it, vi } from 'vitest';
import { publicKeyMatchesLxmfDeliveryDestination } from './lxmf-recipient-identity';

describe('LXMF recipient identity matching', () => {
  const destinationHash = '12'.repeat(16);
  const publicKey = new Uint8Array(64).fill(7);

  it('accepts only a complete key that derives the requested delivery destination', () => {
    const derive = vi.fn(() => new Uint8Array(16).fill(0x12));

    expect(publicKeyMatchesLxmfDeliveryDestination(destinationHash, publicKey, derive)).toBe(true);
    expect(derive).toHaveBeenCalledWith('lxmf.delivery', publicKey);
  });

  it('rejects missing, incomplete, mismatched, and unparseable identities', () => {
    expect(publicKeyMatchesLxmfDeliveryDestination(destinationHash, undefined, vi.fn())).toBe(false);
    expect(publicKeyMatchesLxmfDeliveryDestination(
      destinationHash,
      new Uint8Array(63),
      vi.fn(),
    )).toBe(false);
    expect(publicKeyMatchesLxmfDeliveryDestination(
      destinationHash,
      publicKey,
      () => new Uint8Array(16).fill(0x13),
    )).toBe(false);
    expect(publicKeyMatchesLxmfDeliveryDestination(
      destinationHash,
      publicKey,
      () => { throw new Error('invalid identity'); },
    )).toBe(false);
  });
});
