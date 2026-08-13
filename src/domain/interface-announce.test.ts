import { describe, expect, it } from 'vitest';
import {
  announcePacketDestinationHash,
  createInterfaceAnnounceHistoryRecord,
  hasCurrentInterfaceAnnounce,
  interfaceAnnounceHistoryId,
  interfaceNetworkFingerprint,
  latestDestinationAnnouncedAt,
  lxmfDeliveryAnnounceFingerprint,
  normalizeInterfaceAnnounceHistoryRecord,
  shouldSuppressInterfaceOnlineAnnounce,
} from './interface-announce';
import {
  createRNodeInterfaceDraft,
  createWebSocketInterfaceDraft,
} from './settings';

describe('interface announcement history', () => {
  it('keys records by identity, interface, network, and destination', () => {
    const record = createInterfaceAnnounceHistoryRecord(
      'identity-1',
      'interface-1',
      'network-1',
      '12'.repeat(16),
      'announce-fingerprint-1',
      '2026-07-29T12:00:00.000Z',
    );

    expect(record.id).toBe(interfaceAnnounceHistoryId(
      record.identityId,
      record.interfaceId,
      record.networkFingerprint,
      record.destinationHash,
    ));
    expect(normalizeInterfaceAnnounceHistoryRecord({
      ...record,
      destinationHash: record.destinationHash.toUpperCase(),
      id: 'untrusted-id',
    })).toEqual(record);
    expect(normalizeInterfaceAnnounceHistoryRecord({
      ...record,
      destinationHash: 'invalid',
    })).toBeUndefined();
    expect(normalizeInterfaceAnnounceHistoryRecord({
      ...record,
      announceFingerprint: undefined,
    })).toBeUndefined();
  });

  it('fingerprints every field in the enriched LXMF announce', () => {
    const initial = lxmfDeliveryAnnounceFingerprint('Anonymous', 0);
    expect(lxmfDeliveryAnnounceFingerprint('Anonymous', 0)).toBe(initial);
    expect(lxmfDeliveryAnnounceFingerprint('Renamed', 0)).not.toBe(initial);
    expect(lxmfDeliveryAnnounceFingerprint('Anonymous', 4)).not.toBe(initial);
  });

  it('treats missing or changed announce metadata as stale', () => {
    const current = lxmfDeliveryAnnounceFingerprint('Anonymous', 0);
    const record = createInterfaceAnnounceHistoryRecord(
      'identity-1',
      'interface-1',
      'network-1',
      '12'.repeat(16),
      current,
      '2026-07-29T12:00:00.000Z',
    );

    expect(hasCurrentInterfaceAnnounce(record, current)).toBe(true);
    expect(hasCurrentInterfaceAnnounce(
      record,
      lxmfDeliveryAnnounceFingerprint('Renamed', 0),
    )).toBe(false);
    expect(hasCurrentInterfaceAnnounce(undefined, current)).toBe(false);
  });

  it('finds the newest successful announce within the identity and destination scope', () => {
    const destinationHash = '12'.repeat(16);
    const records = [
      createInterfaceAnnounceHistoryRecord(
        'identity-1',
        'interface-1',
        'network-1',
        destinationHash,
        'announce-fingerprint-1',
        '2026-07-29T12:00:00.000Z',
      ),
      createInterfaceAnnounceHistoryRecord(
        'identity-1',
        'interface-2',
        'network-2',
        destinationHash,
        'announce-fingerprint-1',
        '2026-07-29T13:00:00.000Z',
      ),
      createInterfaceAnnounceHistoryRecord(
        'identity-1',
        'interface-1',
        'network-1',
        '34'.repeat(16),
        'announce-fingerprint-2',
        '2026-07-29T14:00:00.000Z',
      ),
      createInterfaceAnnounceHistoryRecord(
        'identity-2',
        'interface-1',
        'network-1',
        destinationHash,
        'announce-fingerprint-3',
        '2026-07-29T15:00:00.000Z',
      ),
    ];

    expect(latestDestinationAnnouncedAt(records, 'identity-1', destinationHash))
      .toBe('2026-07-29T13:00:00.000Z');
    expect(latestDestinationAnnouncedAt(records, 'identity-1', '56'.repeat(16)))
      .toBeUndefined();
  });

  it('changes the network fingerprint only for material interface changes', () => {
    const websocket = createWebSocketInterfaceDraft('websocket-1');
    const fingerprint = interfaceNetworkFingerprint(websocket);
    expect(interfaceNetworkFingerprint({
      ...websocket,
      name: 'Renamed',
      enabled: false,
      reannounceOnReconnect: false,
    })).toBe(fingerprint);
    expect(interfaceNetworkFingerprint({
      ...websocket,
      connection: { ...websocket.connection, host: 'another-relay.example' },
    })).not.toBe(fingerprint);
    expect(interfaceNetworkFingerprint({
      ...websocket,
      ifac: {
        ...websocket.ifac,
        passphrase: 'new secret',
        credentialRevision: 'new-credential',
      },
    })).not.toBe(fingerprint);

    const rnode = createRNodeInterfaceDraft('ble', 'rnode-1');
    const rnodeFingerprint = interfaceNetworkFingerprint(rnode);
    expect(interfaceNetworkFingerprint({
      ...rnode,
      radio: { ...rnode.radio, frequency: rnode.radio.frequency + 1_000_000 },
    })).not.toBe(rnodeFingerprint);
  });
});

describe('interface-up announcement policy', () => {
  const otherHash = '34'.repeat(16);

  it('suppresses every implicit announce regardless of destination metadata', () => {
    expect(shouldSuppressInterfaceOnlineAnnounce({
      packetType: 'announce',
      destinationHash: Uint8Array.from({ length: 16 }, () => 0x34),
    })).toBe(true);
    expect(shouldSuppressInterfaceOnlineAnnounce({
      packetType: 'announce',
    })).toBe(true);
  });

  it('preserves non-announces and validates destination hashes independently', () => {
    expect(shouldSuppressInterfaceOnlineAnnounce({
      packetType: 'data',
      destinationHash: Array(16).fill(0x34),
    })).toBe(false);
    expect(announcePacketDestinationHash({
      packetType: 'announce',
      destinationHash: Array(15).fill(0x34),
    })).toBeUndefined();
    expect(announcePacketDestinationHash({
      packetType: 'announce',
      destinationHash: Array(16).fill(0x34),
    })).toBe(otherHash);
  });
});
