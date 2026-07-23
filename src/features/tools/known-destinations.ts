import type { ChatAnnounce, ChatContact } from '../../domain/chat';
import type { NomadAnnounce } from '../../domain/nomadnet';
import type { ProvisioningNode } from '../../domain/provisioning';
import type {
  AnnouncedPropagationNode,
  KnownDestinationEntry,
  PathTableEntry,
} from '../../infrastructure/reticulum/protocol';

export type KnownDestinationApplication =
  | 'lxmfDelivery'
  | 'lxmfPropagation'
  | 'nomadnet'
  | 'management'
  | 'unknown';

export interface KnownDestinationPresentation {
  application: KnownDestinationApplication;
  announcedName?: string;
  localContactName?: string;
  path?: PathTableEntry;
  lxmf?: Pick<ChatAnnounce, 'stampCost' | 'compressionSupported'>;
  propagation?: Pick<
    AnnouncedPropagationNode,
    'enabled' | 'transferLimitKb' | 'syncLimitKb' | 'stampCost' | 'peeringCost'
  >;
}

export interface KnownDestinationGroup {
  id: string;
  publicKey?: string;
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
    if (current) current.entries.push(entry);
    else groups.set(id, {
      id,
      publicKey: entry.publicKey,
      entries: [entry],
    });
  }
  return Array.from(groups.values());
}

export function knownDestinationPresentations(
  entries: KnownDestinationEntry[],
  paths: PathTableEntry[],
  chatAnnounces: ChatAnnounce[],
  chatContacts: ChatContact[],
  nomadAnnounces: NomadAnnounce[],
  propagationNodes: AnnouncedPropagationNode[],
  managementNodes: ProvisioningNode[],
): Map<string, KnownDestinationPresentation> {
  const pathsByHash = new Map(paths.map((entry) => [entry.destinationHash, entry]));
  const chatByHash = new Map(chatAnnounces.map((entry) => [entry.destinationHash, entry]));
  const contactsByHash = new Map(chatContacts.map((entry) => [entry.destinationHash, entry]));
  const nomadByHash = new Map(nomadAnnounces.map((entry) => [entry.destinationHash, entry]));
  const propagationByHash = new Map(propagationNodes.map((entry) => [entry.destinationHash, entry]));
  const managementHashes = new Set(managementNodes.map((entry) => entry.destinationHash));

  return new Map(entries.map((entry) => {
    const destinationHash = entry.destinationHash;
    const chat = chatByHash.get(destinationHash);
    const nomad = nomadByHash.get(destinationHash);
    const propagation = propagationByHash.get(destinationHash);
    const application: KnownDestinationApplication = entry.isLocal
      ? entry.fullDestinationName === 'lxmf.delivery' ? 'lxmfDelivery' : 'unknown'
      : chat
        ? 'lxmfDelivery'
        : propagation
          ? 'lxmfPropagation'
          : nomad
            ? 'nomadnet'
            : managementHashes.has(destinationHash)
              ? 'management'
              : 'unknown';
    return [destinationHash, {
      application,
      localContactName: contactsByHash.get(destinationHash)?.name,
      announcedName: chat?.displayName ?? nomad?.displayName,
      path: pathsByHash.get(destinationHash),
      ...(chat ? {
        lxmf: {
          stampCost: chat.stampCost,
          compressionSupported: chat.compressionSupported,
        },
      } : {}),
      ...(propagation ? {
        propagation: {
          enabled: propagation.enabled,
          transferLimitKb: propagation.transferLimitKb,
          syncLimitKb: propagation.syncLimitKb,
          stampCost: propagation.stampCost,
          peeringCost: propagation.peeringCost,
        },
      } : {}),
    }];
  }));
}
