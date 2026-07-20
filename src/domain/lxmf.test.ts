import { describe, expect, it } from 'vitest';
import { createLxmaAddress, parseLxmaAddress } from './lxmf';

describe('LXMF address sharing', () => {
  it('creates the interoperable LXMA address format', () => {
    const destination = '0123456789ABCDEF0123456789ABCDEF';
    const publicKey = 'AB'.repeat(64);
    expect(createLxmaAddress(destination, publicKey)).toBe(
      `lxma://${destination.toLowerCase()}:${publicKey.toLowerCase()}`,
    );
  });

  it('rejects invalid destination hashes and public keys', () => {
    expect(createLxmaAddress('invalid', 'ab'.repeat(64))).toBeUndefined();
    expect(createLxmaAddress('ab'.repeat(16), 'too-short')).toBeUndefined();
  });

  it('parses an LXMA delivery address', () => {
    const address = 'lxma://7b5663f27a4c0bcc301b2967a243e058:d6c7123ef37072ee5fe66a3c7caf5b78e325f2917d1b46464c9872069bde2d3d972a4da471ac1fe239ff1f5c5d2a9b7d28eac5bec513eebc86f5f7ea1a8bc4d4';
    expect(parseLxmaAddress(address.toUpperCase().replace('LXMA://', 'lxma://'))).toEqual({
      destinationHash: '7b5663f27a4c0bcc301b2967a243e058',
      publicKey: 'd6c7123ef37072ee5fe66a3c7caf5b78e325f2917d1b46464c9872069bde2d3d972a4da471ac1fe239ff1f5c5d2a9b7d28eac5bec513eebc86f5f7ea1a8bc4d4',
    });
  });

  it('rejects malformed LXMA addresses', () => {
    expect(parseLxmaAddress('lxmf://7b5663f27a4c0bcc301b2967a243e058')).toBeUndefined();
    expect(parseLxmaAddress(`lxma://${'0'.repeat(32)}:short`)).toBeUndefined();
  });
});
