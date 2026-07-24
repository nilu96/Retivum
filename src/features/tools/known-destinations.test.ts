import { describe, expect, it } from 'vitest';
import {
  groupKnownDestinationsByIdentity,
  knownDestinationPresentations,
} from './known-destinations';

describe('knownDestinationPresentations', () => {
  it('combines recognized announce metadata, local names, and paths', () => {
    const destinationHash = '1'.repeat(32);
    const path = { destinationHash, hops: 2 };
    const presentations = knownDestinationPresentations(
      [{ destinationHash }],
      [path],
      [{
        id: `identity:${destinationHash}`,
        identityId: 'identity',
        destinationHash,
        identityHash: '2'.repeat(32),
        publicKey: '3'.repeat(128),
        displayName: 'Shared Alice',
        stampCost: 8,
        compressionSupported: true,
        heardAt: '2026-07-23T10:00:00.000Z',
      }],
      [{
        id: `identity:${destinationHash}`,
        identityId: 'identity',
        destinationHash,
        name: 'Local Alice',
        createdAt: '2026-07-23T10:00:00.000Z',
        updatedAt: '2026-07-23T10:00:00.000Z',
      }],
      [],
      [],
      [],
    );

    expect(presentations.get(destinationHash)).toEqual({
      application: 'lxmfDelivery',
      fullDestinationName: 'lxmf.delivery',
      localContactName: 'Local Alice',
      announcedName: 'Shared Alice',
      path,
      lxmf: {
        stampCost: 8,
        compressionSupported: true,
      },
    });
  });

  it('classifies propagation, NomadNet, management, and unknown destinations', () => {
    const hashes = ['1', '2', '3', '4'].map((value) => value.repeat(32));
    const presentations = knownDestinationPresentations(
      hashes.map((destinationHash) => ({ destinationHash })),
      [],
      [],
      [],
      [{
        id: hashes[1],
        destinationHash: hashes[1],
        displayName: 'Nomad Node',
        heardAt: '2026-07-23T10:00:00.000Z',
      }],
      [{
        destinationHash: hashes[0],
        enabled: true,
        transferLimitKb: 1_000,
        syncLimitKb: 2_000,
        stampCost: 3,
        peeringCost: 4,
        heardAt: '2026-07-23T10:00:00.000Z',
      }],
      [{
        id: hashes[2],
        destinationHash: hashes[2],
        publicKey: '5'.repeat(128),
        heardAt: '2026-07-23T10:00:00.000Z',
      }],
    );

    expect(hashes.map((hash) => presentations.get(hash)?.application)).toEqual([
      'lxmfPropagation',
      'nomadnet',
      'management',
      'unknown',
    ]);
    expect(hashes.map((hash) => presentations.get(hash)?.fullDestinationName)).toEqual([
      'lxmf.propagation',
      'nomadnetwork.node',
      'rnstransport.remote.management',
      undefined,
    ]);
  });

  it('classifies explicit local delivery and probe destinations and leaves other hashes unknown', () => {
    const deliveryHash = '5'.repeat(32);
    const propagationHash = '6'.repeat(32);
    const probeHash = '7'.repeat(32);
    const presentations = knownDestinationPresentations(
      [{
        destinationHash: deliveryHash,
        isLocal: true,
        fullDestinationName: 'lxmf.delivery',
      }, {
        destinationHash: propagationHash,
        isLocal: true,
      }, {
        destinationHash: probeHash,
        publicKey: '8'.repeat(128),
        fullDestinationName: 'rnstransport.probe',
      }],
      [],
      [],
      [],
      [],
      [],
      [],
    );

    expect(presentations.get(deliveryHash)?.application).toBe('lxmfDelivery');
    expect(presentations.get(propagationHash)?.application).toBe('unknown');
    expect(presentations.get(probeHash)).toEqual(expect.objectContaining({
      application: 'probe',
      fullDestinationName: 'rnstransport.probe',
    }));
  });

  it('sorts identity groups by their latest announce and groups matching public keys', () => {
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
