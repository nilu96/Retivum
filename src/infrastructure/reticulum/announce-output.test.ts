import { describe, expect, it } from 'vitest';
import { isSuppressedAnnounce } from './announce-output';

describe('isSuppressedAnnounce', () => {
  const lxmfDestinationHash = '12'.repeat(16);
  const suppressedDestinationHashes = new Set([lxmfDestinationHash]);

  it('suppresses an announce whose destination is in the collection', () => {
    expect(isSuppressedAnnounce({
      packetType: 'announce',
      destinationHash: Array(16).fill(0x12),
    }, suppressedDestinationHashes)).toBe(true);
  });

  it('preserves announces whose destinations are not in the collection', () => {
    expect(isSuppressedAnnounce({
      packetType: 'announce',
      destinationHash: Array(16).fill(0x34),
    }, suppressedDestinationHashes)).toBe(false);
  });

  it('preserves non-announce packets and announces without a suppression collection', () => {
    expect(isSuppressedAnnounce({
      packetType: 'data',
      destinationHash: Array(16).fill(0x12),
    }, suppressedDestinationHashes)).toBe(false);
    expect(isSuppressedAnnounce({
      packetType: 'announce',
    }, suppressedDestinationHashes)).toBe(false);
    expect(isSuppressedAnnounce({
      packetType: 'announce',
      destinationHash: Array(16).fill(0x12),
    }, undefined)).toBe(false);
  });
});
