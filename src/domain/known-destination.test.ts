import { describe, expect, it } from 'vitest';
import {
  knownDestinationDirectory,
  knownIdentityMetadata,
  normalizeKnownDestination,
  orphanedKnownDestinationHashes,
  upsertKnownDestination,
} from './known-destination';

describe('known destination directory', () => {
  it('preserves an omitted name and replaces the complete metadata snapshot', () => {
    const destinationHash = 'a'.repeat(32);
    const current = [{
      destinationHash,
      fullDestinationName: 'lxmf.delivery' as const,
      displayName: 'Alice',
      lastAnnouncedAt: '2026-07-24T10:00:00.000Z',
      metadata: { stampCost: 4, compressionSupported: true },
    }];

    expect(upsertKnownDestination(current, {
      destinationHash,
      fullDestinationName: 'lxmf.delivery',
      lastAnnouncedAt: '2026-07-24T11:00:00.000Z',
      metadata: { stampCost: 8 },
    })).toEqual([{
      ...current[0],
      lastAnnouncedAt: '2026-07-24T11:00:00.000Z',
      metadata: { stampCost: 8 },
    }]);
  });

  it('preserves valid metadata when an observation omits or supplies invalid metadata', () => {
    const destinationHash = 'f'.repeat(32);
    const current = [{
      destinationHash,
      fullDestinationName: 'lxmf.delivery' as const,
      lastAnnouncedAt: '2026-07-24T10:00:00.000Z',
      metadata: { stampCost: 4, compressionSupported: true },
    }];

    const withoutMetadata = upsertKnownDestination(current, {
      destinationHash,
      lastAnnouncedAt: '2026-07-24T11:00:00.000Z',
    });
    expect(withoutMetadata[0].metadata).toEqual(current[0].metadata);

    expect(upsertKnownDestination(withoutMetadata, {
      destinationHash,
      fullDestinationName: 'lxmf.delivery',
      lastAnnouncedAt: '2026-07-24T12:00:00.000Z',
      metadata: { stampCost: Number.NaN },
    })[0].metadata).toEqual(current[0].metadata);
  });

  it('treats valid empty metadata as an authoritative empty snapshot', () => {
    const destinationHash = 'e'.repeat(32);
    expect(upsertKnownDestination([{
      destinationHash,
      fullDestinationName: 'lxmf.delivery',
      metadata: { stampCost: 4, compressionSupported: true },
    }], {
      destinationHash,
      fullDestinationName: 'lxmf.delivery',
      metadata: {},
    })[0].metadata).toEqual({});
  });

  it('ignores stale observations and clears aspect-specific data on reclassification', () => {
    const destinationHash = 'b'.repeat(32);
    const current = [{
      destinationHash,
      fullDestinationName: 'lxmf.delivery' as const,
      displayName: 'Peer',
      lastAnnouncedAt: '2026-07-24T11:00:00.000Z',
      metadata: { stampCost: 4 },
    }];

    expect(upsertKnownDestination(current, {
      destinationHash,
      lastAnnouncedAt: '2026-07-24T10:00:00.000Z',
    })).toEqual(current);
    expect(upsertKnownDestination(current, {
      destinationHash,
      fullDestinationName: 'rnstransport.remote.management',
      lastAnnouncedAt: '2026-07-24T12:00:00.000Z',
      metadata: {},
    })[0]).toEqual({
      destinationHash,
      fullDestinationName: 'rnstransport.remote.management',
      lastAnnouncedAt: '2026-07-24T12:00:00.000Z',
      metadata: {},
    });
  });

  it('rejects malformed registered metadata at the persistence boundary', () => {
    expect(normalizeKnownDestination({
      destinationHash: 'c'.repeat(32),
      fullDestinationName: 'lxmf.propagation',
      metadata: {
        enabled: true,
        transferLimitKb: Number.NaN,
        syncLimitKb: 2_000,
        stampCost: 3,
        peeringCost: 4,
      },
    })).toEqual({
      destinationHash: 'c'.repeat(32),
      fullDestinationName: 'lxmf.propagation',
    });
  });

  it('finds enrichment records missing from the complete Leviculum identity inventory', () => {
    const retainedHash = 'd'.repeat(32);
    const removedHash = 'e'.repeat(32);
    expect(orphanedKnownDestinationHashes([
      { destinationHash: retainedHash, displayName: 'Retained' },
      { destinationHash: removedHash },
    ], [
      retainedHash.toUpperCase(),
      'not-a-destination',
    ])).toEqual([removedHash]);
  });

  it('derives shared names only from NomadNet destinations with matching public keys', () => {
    const publicKey = 'a'.repeat(128);
    const otherPublicKey = 'b'.repeat(128);
    const nomadHash = '2'.repeat(32);
    const managementHash = '3'.repeat(32);
    const unrelatedHash = '4'.repeat(32);
    const records = [{
      destinationHash: nomadHash,
      fullDestinationName: 'nomadnetwork.node' as const,
      displayName: 'Forest Node',
    }, {
      destinationHash: managementHash,
      fullDestinationName: 'rnstransport.remote.management' as const,
    }, {
      destinationHash: unrelatedHash,
      fullDestinationName: 'rnstransport.remote.management' as const,
    }];
    const inventory = [{
      destinationHash: nomadHash,
      publicKey,
    }, {
      destinationHash: managementHash,
      publicKey,
    }, {
      destinationHash: unrelatedHash,
      publicKey: otherPublicKey,
    }];

    expect(knownIdentityMetadata(records, inventory)).toEqual(new Map([[
      publicKey,
      {
        publicKey,
        sharedDisplayName: 'Forest Node',
        provenance: 'protocol',
      },
    ]]));
    expect(knownDestinationDirectory(records, inventory)).toEqual([
      {
        ...records[0],
        publicKey,
        sharedDisplayName: 'Forest Node',
      },
      {
        ...records[1],
        publicKey,
        sharedDisplayName: 'Forest Node',
      },
      {
        ...records[2],
        publicKey: otherPublicKey,
      },
    ]);
  });
});
