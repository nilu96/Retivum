export const knownFullDestinationNames = [
  'lxmf.delivery',
  'lxmf.propagation',
  'nomadnetwork.node',
  'rnstransport.probe',
  'rnstransport.remote.management',
] as const;

export type KnownFullDestinationName = typeof knownFullDestinationNames[number];

export interface LxmfDeliveryDestinationMetadata {
  stampCost?: number;
  compressionSupported?: boolean;
}

export interface LxmfPropagationDestinationMetadata {
  enabled: boolean;
  transferLimitKb: number;
  syncLimitKb: number;
  stampCost: number;
  peeringCost: number;
}

export interface KnownDestinationMetadataMap {
  'lxmf.delivery': LxmfDeliveryDestinationMetadata;
  'lxmf.propagation': LxmfPropagationDestinationMetadata;
  'nomadnetwork.node': Record<string, never>;
  'rnstransport.probe': Record<string, never>;
  'rnstransport.remote.management': Record<string, never>;
}

export type KnownDestinationMetadata =
  KnownDestinationMetadataMap[keyof KnownDestinationMetadataMap];

/**
 * One global, application-owned projection of facts learned about a remote
 * Reticulum destination. Public identities, raw announces, and paths remain
 * authoritative inside Leviculum and are deliberately not duplicated here.
 */
export interface KnownDestinationRecord {
  destinationHash: string;
  fullDestinationName?: KnownFullDestinationName;
  lastAnnouncedAt?: string;
  displayName?: string;
  metadata?: KnownDestinationMetadata;
}

export type KnownDestinationOf<Name extends KnownFullDestinationName> =
  KnownDestinationRecord & {
    fullDestinationName: Name;
    metadata?: KnownDestinationMetadataMap[Name];
  };

export interface KnownDestinationInventoryEntry {
  destinationHash: string;
  publicKey?: string;
  lastAnnouncedAt?: string;
  fullDestinationName?: string;
}

export interface KnownIdentityMetadata {
  publicKey: string;
  sharedDisplayName?: string;
  provenance: 'local' | 'protocol';
}

export type KnownDestinationDirectoryEntry<Name extends KnownFullDestinationName =
  KnownFullDestinationName> = KnownDestinationOf<Name> & {
    publicKey?: string;
    sharedDisplayName?: string;
  };

/**
 * Joins persistent destination facts with worker-owned public identities.
 * Identity metadata is derived only for identities whose verified NomadNet
 * destination supplied a non-empty node name.
 */
export function knownIdentityMetadata(
  records: readonly KnownDestinationRecord[],
  inventory: readonly KnownDestinationInventoryEntry[],
): Map<string, KnownIdentityMetadata> {
  const publicKeysByHash = new Map(inventory.flatMap((entry) => {
    const publicKey = normalizePublicKey(entry.publicKey);
    return publicKey ? [[entry.destinationHash, publicKey] as const] : [];
  }));
  const identities = new Map<string, KnownIdentityMetadata>();
  for (const destination of destinationsByFullName(records, 'nomadnetwork.node')) {
    const publicKey = publicKeysByHash.get(destination.destinationHash);
    const sharedDisplayName = destination.displayName?.trim();
    if (!publicKey || !sharedDisplayName || identities.has(publicKey)) continue;
    identities.set(publicKey, {
      publicKey,
      sharedDisplayName,
      provenance: 'protocol',
    });
  }
  return identities;
}

/**
 * Read-only directory projection for features that need runtime identity
 * information in addition to persistent destination facts.
 */
export function knownDestinationDirectory(
  records: readonly KnownDestinationRecord[],
  inventory: readonly KnownDestinationInventoryEntry[],
): KnownDestinationDirectoryEntry[] {
  const inventoryByHash = new Map(inventory.map((entry) => [entry.destinationHash, entry]));
  const identities = knownIdentityMetadata(records, inventory);
  return records.flatMap((record) => {
    if (!record.fullDestinationName) return [];
    const publicKey = normalizePublicKey(inventoryByHash.get(record.destinationHash)?.publicKey);
    const sharedDisplayName = publicKey
      ? identities.get(publicKey)?.sharedDisplayName
      : undefined;
    return [{
      ...record,
      ...(publicKey ? { publicKey } : {}),
      ...(sharedDisplayName ? { sharedDisplayName } : {}),
    } as KnownDestinationDirectoryEntry];
  });
}

export function destinationsByFullName<
  Name extends KnownFullDestinationName,
  Entry extends KnownDestinationRecord,
>(
  records: readonly Entry[],
  fullDestinationName: Name,
): Array<Entry & KnownDestinationOf<Name>> {
  return records.filter((record): record is Entry & KnownDestinationOf<Name> => (
    record.fullDestinationName === fullDestinationName
  ));
}

export function knownDestinationByHash(
  records: readonly KnownDestinationRecord[],
  destinationHash: string,
): KnownDestinationRecord | undefined {
  return records.find((record) => record.destinationHash === destinationHash);
}

export function upsertKnownDestination(
  records: readonly KnownDestinationRecord[],
  incoming: KnownDestinationRecord,
): KnownDestinationRecord[] {
  const normalized = normalizeKnownDestination(incoming);
  if (!normalized) return [...records];
  const current = knownDestinationByHash(records, normalized.destinationHash);
  if (current?.lastAnnouncedAt && normalized.lastAnnouncedAt
    && current.lastAnnouncedAt > normalized.lastAnnouncedAt) {
    return [...records];
  }
  const aspectChanged = current?.fullDestinationName !== undefined
    && normalized.fullDestinationName !== undefined
    && current.fullDestinationName !== normalized.fullDestinationName;
  const metadataProvided = Object.prototype.hasOwnProperty.call(incoming, 'metadata');
  const displayName = aspectChanged
    ? normalized.displayName
    : normalized.displayName ?? current?.displayName;
  const metadata = aspectChanged
    ? normalized.metadata
    : metadataProvided && normalized.metadata !== undefined
      ? normalized.metadata
      : current?.metadata;
  const updated: KnownDestinationRecord = {
    ...current,
    ...normalized,
    ...(displayName ? { displayName } : {}),
    ...(metadata !== undefined ? { metadata } : {}),
  };
  if (!displayName) delete updated.displayName;
  if (metadata === undefined) delete updated.metadata;
  return sortKnownDestinations([
    updated,
    ...records.filter((record) => record.destinationHash !== updated.destinationHash),
  ]);
}

/**
 * Startup-only reconciliation against Leviculum's authoritative destination
 * inventory. Local destinations are runtime-owned and are not persisted here.
 */
export function reconcileKnownDestinations(
  records: readonly KnownDestinationRecord[],
  inventory: readonly KnownDestinationInventoryEntry[],
): KnownDestinationRecord[] {
  const knownHashes = new Set(inventory.map((entry) => entry.destinationHash));
  let reconciled = records.filter((record) => knownHashes.has(record.destinationHash));
  for (const entry of inventory) {
    const fullDestinationName = isKnownFullDestinationName(entry.fullDestinationName)
      ? entry.fullDestinationName
      : undefined;
    reconciled = upsertKnownDestination(reconciled, {
      destinationHash: entry.destinationHash,
      ...(fullDestinationName ? { fullDestinationName } : {}),
      ...(entry.lastAnnouncedAt ? { lastAnnouncedAt: entry.lastAnnouncedAt } : {}),
    });
  }
  return sortKnownDestinations(reconciled);
}

export function normalizeKnownDestination(
  value: KnownDestinationRecord,
): KnownDestinationRecord | undefined {
  const destinationHash = value.destinationHash.trim().toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(destinationHash)) return undefined;
  const displayName = value.displayName?.trim().slice(0, 256);
  const fullDestinationName = isKnownFullDestinationName(value.fullDestinationName)
    ? value.fullDestinationName
    : undefined;
  const metadata = fullDestinationName
    ? normalizeMetadata(fullDestinationName, value.metadata)
    : undefined;
  return {
    destinationHash,
    ...(fullDestinationName ? { fullDestinationName } : {}),
    ...(validIsoDate(value.lastAnnouncedAt) ? { lastAnnouncedAt: value.lastAnnouncedAt } : {}),
    ...(displayName ? { displayName } : {}),
    ...(metadata !== undefined ? { metadata } : {}),
  };
}

/**
 * Validates and bounds aspect-specific metadata at the shared persistence
 * boundary. Feature code can therefore consume registered metadata without
 * re-validating arbitrary IndexedDB or worker values.
 */
export function normalizeMetadata<Name extends KnownFullDestinationName>(
  fullDestinationName: Name,
  value: unknown,
): KnownDestinationMetadataMap[Name] | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const source = value as Record<string, unknown>;
  if (fullDestinationName === 'lxmf.delivery') {
    const stampCost = finiteNumber(source.stampCost);
    const compressionSupported = typeof source.compressionSupported === 'boolean'
      ? source.compressionSupported
      : undefined;
    if ((Object.prototype.hasOwnProperty.call(source, 'stampCost') && stampCost === undefined)
      || (Object.prototype.hasOwnProperty.call(source, 'compressionSupported')
        && compressionSupported === undefined)) {
      return undefined;
    }
    return {
      ...(stampCost !== undefined ? { stampCost } : {}),
      ...(compressionSupported !== undefined ? { compressionSupported } : {}),
    } as KnownDestinationMetadataMap[Name];
  }
  if (fullDestinationName === 'lxmf.propagation') {
    const transferLimitKb = finiteNumber(source.transferLimitKb);
    const syncLimitKb = finiteNumber(source.syncLimitKb);
    const stampCost = finiteNumber(source.stampCost);
    const peeringCost = finiteNumber(source.peeringCost);
    if (typeof source.enabled !== 'boolean'
      || transferLimitKb === undefined
      || syncLimitKb === undefined
      || stampCost === undefined
      || peeringCost === undefined) {
      return undefined;
    }
    return {
      enabled: source.enabled,
      transferLimitKb,
      syncLimitKb,
      stampCost,
      peeringCost,
    } as KnownDestinationMetadataMap[Name];
  }
  return {} as KnownDestinationMetadataMap[Name];
}

export function isKnownFullDestinationName(
  value: unknown,
): value is KnownFullDestinationName {
  return typeof value === 'string'
    && (knownFullDestinationNames as readonly string[]).includes(value);
}

function sortKnownDestinations(
  records: readonly KnownDestinationRecord[],
): KnownDestinationRecord[] {
  return [...records].sort((left, right) => (
    (right.lastAnnouncedAt ?? '').localeCompare(left.lastAnnouncedAt ?? '')
    || left.destinationHash.localeCompare(right.destinationHash)
  ));
}

function validIsoDate(value: string | undefined): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function normalizePublicKey(value: string | undefined): string | undefined {
  const normalized = value?.trim().toLowerCase();
  return normalized && /^[0-9a-f]{128}$/.test(normalized) ? normalized : undefined;
}
