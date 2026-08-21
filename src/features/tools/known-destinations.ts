import type { ChatContact } from '../../domain/chat';
import {
  isKnownFullDestinationName,
  knownDestinationDirectory,
  type KnownDestinationRecord,
  type LxmfDeliveryDestinationMetadata,
  type LxmfPropagationDestinationMetadata,
} from '../../domain/known-destination';
import type {
  KnownDestinationEntry,
  PathTableEntry,
} from '../../infrastructure/reticulum/protocol';

export type KnownDestinationApplication =
  | 'lxmfDelivery'
  | 'lxmfPropagation'
  | 'nomadnet'
  | 'management'
  | 'probe'
  | 'unknown';

export type ProbeableDestinationName =
  | 'lxmf.delivery'
  | 'lxmf.propagation'
  | 'nomadnetwork.node'
  | 'rnstransport.remote.management'
  | 'rnstransport.probe';

export interface KnownDestinationPresentation {
  application: KnownDestinationApplication;
  fullDestinationName?: ProbeableDestinationName;
  displayName?: string;
  localContactName?: string;
  path?: PathTableEntry;
  lxmf?: LxmfDeliveryDestinationMetadata;
  propagation?: LxmfPropagationDestinationMetadata;
}

export interface KnownDestinationGroup {
  id: string;
  publicKey?: string;
  identityHash?: string;
  entries: KnownDestinationEntry[];
}

export function sortKnownDestinationsByLastAnnounce(
  entries: KnownDestinationEntry[],
): KnownDestinationEntry[] {
  return [...entries].sort((left, right) => (
    (right.lastAnnouncedAt ?? '').localeCompare(left.lastAnnouncedAt ?? '')
    || left.destinationHash.localeCompare(right.destinationHash)
  ));
}

export function groupKnownDestinationsByIdentity(
  entries: KnownDestinationEntry[],
  enabled: boolean,
): KnownDestinationGroup[] {
  const sorted = sortKnownDestinationsByLastAnnounce(entries);
  if (!enabled) return [{ id: 'all', entries: sorted }];
  const groups = new Map<string, KnownDestinationGroup>();
  for (const entry of sorted) {
    const id = entry.publicKey ? `identity:${entry.publicKey}` : `destination:${entry.destinationHash}`;
    const current = groups.get(id);
    if (current) {
      current.entries.push(entry);
      current.identityHash ??= entry.identityHash;
    }
    else groups.set(id, {
      id,
      publicKey: entry.publicKey,
      identityHash: entry.identityHash,
      entries: [entry],
    });
  }
  return Array.from(groups.values());
}

export function knownDestinationPresentations(
  entries: readonly KnownDestinationEntry[],
  records: readonly KnownDestinationRecord[],
  paths: readonly PathTableEntry[],
  chatContacts: readonly ChatContact[],
): Map<string, KnownDestinationPresentation> {
  const recordsByHash = new Map(records.map((record) => [record.destinationHash, record]));
  const pathsByHash = new Map(paths.map((entry) => [entry.destinationHash, entry]));
  const contactsByHash = new Map(chatContacts.map((entry) => [entry.destinationHash, entry]));
  const directoryByHash = new Map(knownDestinationDirectory(records, entries)
    .map((entry) => [entry.destinationHash, entry]));

  return new Map(entries.map((entry) => {
    const destinationHash = entry.destinationHash;
    const record = recordsByHash.get(destinationHash);
    const fullDestinationName = isKnownFullDestinationName(record?.fullDestinationName)
      ? record.fullDestinationName
      : isKnownFullDestinationName(entry.fullDestinationName)
        ? entry.fullDestinationName
        : undefined;
    const application: KnownDestinationApplication = fullDestinationName === 'lxmf.delivery'
      ? 'lxmfDelivery'
      : fullDestinationName === 'lxmf.propagation'
        ? 'lxmfPropagation'
        : fullDestinationName === 'nomadnetwork.node'
          ? 'nomadnet'
          : fullDestinationName === 'rnstransport.remote.management'
            ? 'management'
            : fullDestinationName === 'rnstransport.probe'
              ? 'probe'
              : 'unknown';
    return [destinationHash, {
      application,
      ...(fullDestinationName ? { fullDestinationName } : {}),
      localContactName: contactsByHash.get(destinationHash)?.name,
      displayName: record?.displayName ?? directoryByHash.get(destinationHash)?.sharedDisplayName,
      path: pathsByHash.get(destinationHash),
      ...(fullDestinationName === 'lxmf.delivery' && record?.metadata
        ? { lxmf: record.metadata as LxmfDeliveryDestinationMetadata }
        : {}),
      ...(fullDestinationName === 'lxmf.propagation' && record?.metadata
        ? { propagation: record.metadata as LxmfPropagationDestinationMetadata }
        : {}),
    }];
  }));
}
