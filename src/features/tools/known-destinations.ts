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
    const fullDestinationName: ProbeableDestinationName | undefined =
      entry.fullDestinationName === 'lxmf.delivery'
      || entry.fullDestinationName === 'lxmf.propagation'
      || entry.fullDestinationName === 'nomadnetwork.node'
      || entry.fullDestinationName === 'rnstransport.remote.management'
      || entry.fullDestinationName === 'rnstransport.probe'
        ? entry.fullDestinationName
        : chat
          ? 'lxmf.delivery'
          : propagation
            ? 'lxmf.propagation'
            : nomad
              ? 'nomadnetwork.node'
              : managementHashes.has(destinationHash)
                ? 'rnstransport.remote.management'
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
