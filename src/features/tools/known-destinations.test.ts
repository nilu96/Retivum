import { describe, expect, it } from 'vitest';
import {
  groupKnownDestinationsByIdentity,
  knownDestinationPresentations,
} from './known-destinations';

describe('knownDestinationPresentations', () => {
  it('combines shared destination metadata, local contact names, and paths', () => {
    const destinationHash = '1'.repeat(32);
    const path = { destinationHash, hops: 2 };
    const presentations = knownDestinationPresentations(
      [{ destinationHash }],
      [{
        destinationHash,
        fullDestinationName: 'lxmf.delivery',
        displayName: 'Shared Alice',
        lastAnnouncedAt: '2026-07-23T10:00:00.000Z',
        metadata: { stampCost: 8, compressionSupported: true },
      }],
      [path],
      [{
        id: `identity:${destinationHash}`,
        identityId: 'identity',
        destinationHash,
        name: 'Local Alice',
        createdAt: '2026-07-23T10:00:00.000Z',
        updatedAt: '2026-07-23T10:00:00.000Z',
      }],
    );

    expect(presentations.get(destinationHash)).toEqual({
      application: 'lxmfDelivery',
      fullDestinationName: 'lxmf.delivery',
      localContactName: 'Local Alice',
      displayName: 'Shared Alice',
      path,
      lxmf: {
        stampCost: 8,
        compressionSupported: true,
      },
    });
  });

  it('classifies every recognized destination and unknown hashes', () => {
    const hashes = ['1', '2', '3', '4', '5'].map((value) => value.repeat(32));
    const presentations = knownDestinationPresentations(
      hashes.map((destinationHash) => ({ destinationHash })),
      [{
        destinationHash: hashes[0],
        fullDestinationName: 'lxmf.propagation',
        metadata: {
          enabled: true,
          transferLimitKb: 1_000,
          syncLimitKb: 2_000,
          stampCost: 3,
          peeringCost: 4,
        },
      }, {
        destinationHash: hashes[1],
        fullDestinationName: 'nomadnetwork.node',
        displayName: 'Nomad Node',
      }, {
        destinationHash: hashes[2],
        fullDestinationName: 'rnstransport.remote.management',
      }, {
        destinationHash: hashes[4],
        fullDestinationName: 'rnstransport.probe',
      }],
      [],
      [],
    );

    expect(hashes.map((hash) => presentations.get(hash)?.application)).toEqual([
      'lxmfPropagation',
      'nomadnet',
      'management',
      'unknown',
      'probe',
    ]);
  });

  it('uses full destination names supplied by the worker inventory', () => {
    const deliveryHash = '5'.repeat(32);
    const unknownHash = '6'.repeat(32);
    const presentations = knownDestinationPresentations(
      [{
        destinationHash: deliveryHash,
        fullDestinationName: 'lxmf.delivery',
      }, {
        destinationHash: unknownHash,
      }],
      [],
      [],
      [],
    );

    expect(presentations.get(deliveryHash)?.application).toBe('lxmfDelivery');
    expect(presentations.get(unknownHash)?.application).toBe('unknown');
  });

  it('uses an identity shared name only when the exact destination has no display name', () => {
    const publicKey = 'a'.repeat(128);
    const nomadHash = '7'.repeat(32);
    const managementHash = '8'.repeat(32);
    const deliveryHash = '9'.repeat(32);
    const presentations = knownDestinationPresentations(
      [nomadHash, managementHash, deliveryHash].map((destinationHash) => ({
        destinationHash,
        publicKey,
      })),
      [{
        destinationHash: nomadHash,
        fullDestinationName: 'nomadnetwork.node',
        displayName: 'Forest Node',
      }, {
        destinationHash: managementHash,
        fullDestinationName: 'rnstransport.remote.management',
      }, {
        destinationHash: deliveryHash,
        fullDestinationName: 'lxmf.delivery',
        displayName: 'Exact Peer',
      }],
      [],
      [{
        id: `identity:${managementHash}`,
        identityId: 'identity',
        destinationHash: managementHash,
        name: 'Management Bookmark',
        createdAt: '2026-07-23T10:00:00.000Z',
        updatedAt: '2026-07-23T10:00:00.000Z',
      }],
    );

    expect(presentations.get(managementHash)?.displayName).toBe('Forest Node');
    expect(presentations.get(deliveryHash)?.displayName).toBe('Exact Peer');
  });

  it('sorts identity groups by latest announce and groups matching public keys', () => {
    const sharedPublicKey = 'a'.repeat(128);
    const groups = groupKnownDestinationsByIdentity([
      {
        destinationHash: '1'.repeat(32),
        publicKey: sharedPublicKey,
        lastAnnouncedAt: '2026-07-21T10:00:00.000Z',
      },
      {
        destinationHash: '2'.repeat(32),
        publicKey: 'b'.repeat(128),
        lastAnnouncedAt: '2026-07-23T10:00:00.000Z',
      },
      {
        destinationHash: '3'.repeat(32),
        publicKey: sharedPublicKey,
        lastAnnouncedAt: '2026-07-22T10:00:00.000Z',
      },
    ], true);

    expect(groups.map((group) => group.entries.map((entry) => entry.destinationHash))).toEqual([
      ['2'.repeat(32)],
      ['3'.repeat(32), '1'.repeat(32)],
    ]);
  });
});
