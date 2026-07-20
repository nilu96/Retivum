import type { PersistedIdentityRecord } from '../../domain/identity';
import type { PersistedNetworkStateRecord } from '../../domain/network-state';
import type { ReticulumLogEntry } from '../../domain/logging';
import type { NomadPageLoadStage, NomadRequestData } from '../../domain/nomadnet';
import type { AppPreferences, InterfaceConfig } from '../../domain/settings';
import type { ChatAttachment } from '../../domain/chat';

export type RuntimeState = 'starting' | 'noInterfaces' | 'connecting' | 'online' | 'offline' | 'error';
export type InterfaceRuntimeState = 'disabled' | 'connecting' | 'online' | 'reconnecting' | 'offline' | 'error';

export interface RuntimeConfiguration {
  preferences: AppPreferences;
  interfaces: InterfaceConfig[];
}

export interface NewIdentityMetadata {
  id: string;
  label: string;
  displayName: string;
}

export interface LxmfPropagationSyncResult {
  received: number;
  duplicates: number;
}

export interface ChatMessageQueueResult {
  ok: boolean;
  code?: string;
}

export interface DestinationPathStatus {
  destinationHash: string;
  hasPath: boolean;
  hops?: number;
}

export interface AnnouncedPropagationNode {
  destinationHash: string;
  enabled: boolean;
  transferLimitKb: number;
  syncLimitKb: number;
  stampCost: number;
  peeringCost: number;
  interfaceId?: string;
  hops?: number;
  heardAt: string;
}

export type RuntimeCommand =
  | {
      type: 'initialize';
      wrappingKey: CryptoKey;
      identity?: PersistedIdentityRecord;
      networkState?: PersistedNetworkStateRecord;
      blockedDestinationHashes: string[];
      contactDestinationHashes: string[];
      newIdentity: NewIdentityMetadata;
      configuration: RuntimeConfiguration;
    }
  | { type: 'applyConfiguration'; configuration: RuntimeConfiguration }
  | { type: 'announceLxmf'; requestId: string }
  | {
      type: 'syncLxmfPropagation';
      requestId: string;
    }
  | {
      type: 'sendLxmfMessage';
      requestId: string;
      destinationHash: string;
      title: string;
      content: string;
      attachments?: ChatAttachment[];
      propagationFallback?: boolean;
      replacesMessageId?: string;
      timestamp?: number;
    }
  | {
      type: 'importLxmaPeer';
      requestId: string;
      uri: string;
    }
  | { type: 'cancelLxmfMessage'; requestId: string; messageId: string }
  | { type: 'setLxmfIgnoredDestinations'; requestId: string; destinationHashes: string[] }
  | { type: 'setChatContactDestinations'; destinationHashes: string[] }
  | {
      type: 'requestNomadPage';
      requestId: string;
      destinationHash: string;
      path: string;
      requestData: NomadRequestData;
      publicKey: string;
      freshLink?: boolean;
    }
  | {
      type: 'identifyNomadLink';
      requestId: string;
      destinationHash: string;
    }
  | { type: 'cancelNomadPage'; destinationHash: string; closeLink?: boolean }
  | { type: 'queryDestinationPaths'; destinationHashes: string[] }
  | { type: 'updateIdentityDisplayName'; requestId: string; displayName: string }
  | { type: 'createIdentity'; requestId: string; metadata: NewIdentityMetadata }
  | {
      type: 'importIdentity';
      requestId: string;
      metadata: NewIdentityMetadata;
      privateKey: Uint8Array;
      expectedIdentityHash?: string;
    }
  | { type: 'exportIdentity'; requestId: string; identity: PersistedIdentityRecord }
  | {
      type: 'activateIdentity';
      requestId: string;
      identity: PersistedIdentityRecord;
      blockedDestinationHashes: string[];
      contactDestinationHashes: string[];
    }
  | { type: 'activationStorageResult'; requestId: string; ok: boolean }
  | { type: 'persistenceResult'; requestId: string; ok: boolean }
  | { type: 'networkPersistenceResult'; requestId: string; ok: boolean }
  | { type: 'platformInterfaceState'; id: string; state: 'online' | 'offline' | 'error'; errorCode?: string }
  | { type: 'platformInterfaceData'; id: string; data: Uint8Array }
  | { type: 'shutdown' };

export type RuntimeEvent =
  | { type: 'runtimeStatus'; state: RuntimeState }
  | { type: 'interfaceStatus'; id: string; state: InterfaceRuntimeState; errorCode?: string }
  | { type: 'lxmfPropagationSyncStatus'; syncing: boolean }
  | { type: 'identityReady'; identity: PersistedIdentityRecord; deliveryDestinationHashHex?: string }
  | { type: 'persistIdentity'; requestId: string; identity: PersistedIdentityRecord; activate?: boolean }
  | { type: 'persistNetworkState'; requestId: string; networkState: PersistedNetworkStateRecord }
  | { type: 'identityDisplayNameResult'; requestId: string; ok: boolean }
  | { type: 'lxmfAnnounceResult'; requestId: string; ok: boolean }
  | {
      type: 'lxmfPropagationSyncResult';
      requestId: string;
      ok: boolean;
      received?: number;
      duplicates?: number;
      code?: string;
    }
  | {
      type: 'chatMessageQueued';
      requestId: string;
      identityId: string;
      messageId: string;
      sourceHash: string;
      destinationHash: string;
      title: string;
      content: string;
      attachments?: ChatAttachment[];
      method: string;
      propagationFallbackPending: boolean;
      replacesMessageId?: string;
      timestamp: number;
      queuedAt: string;
    }
  | { type: 'chatMessageQueueFailed'; requestId: string; code: string }
  | { type: 'chatMessageOperationResult'; requestId: string; ok: boolean; code?: string }
  | { type: 'lxmfIgnoredDestinationsResult'; requestId: string; ok: boolean; code?: string }
  | {
      type: 'lxmaPeerImportResult';
      requestId: string;
      ok: boolean;
      destinationHash?: string;
      code?: string;
    }
  | { type: 'chatMessageState'; identityId: string; messageId: string; state: string }
  | {
      type: 'chatMessageProgress';
      identityId: string;
      messageId: string;
      state: string;
      method: string;
      representation: string;
      attempts: number;
      maxAttempts: number;
      progress: number;
    }
  | {
      type: 'chatInboundTransfer';
      transferId: string;
      destinationHash?: string;
      state: 'receiving' | 'completed' | 'failed';
      progress: number;
      dataSize: number;
      transferSize?: number;
    }
  | { type: 'chatInboundTransfersCleared' }
  | { type: 'identityCreated'; requestId: string; identity: PersistedIdentityRecord }
  | { type: 'identityExported'; requestId: string; identityId: string; privateKey: Uint8Array }
  | { type: 'identityActivationStorageRequested'; requestId: string; identityId: string }
  | { type: 'identityOperationResult'; requestId: string; ok: boolean }
  | { type: 'runtimeLog'; entry: ReticulumLogEntry }
  | { type: 'platformInterfaceOpen'; config: InterfaceConfig }
  | { type: 'platformInterfaceClose'; id: string }
  | { type: 'platformInterfaceWrite'; id: string; data: Uint8Array; highPriority?: boolean }
  | {
      type: 'nomadAnnounce';
      identityId: string;
      destinationHash: string;
      displayName?: string;
      publicKey?: string;
      interfaceId?: string;
      hops?: number;
      heardAt: string;
    }
  | ({ type: 'propagationNodeAnnounce' } & AnnouncedPropagationNode)
  | { type: 'propagationNodeSnapshot'; nodes: AnnouncedPropagationNode[] }
  | {
      type: 'nomadPageLoaded';
      requestId: string;
      destinationHash: string;
      path: string;
      requestData: NomadRequestData;
      content: string;
      receivedAt: string;
    }
  | {
      type: 'nomadPageProgress';
      requestId: string;
      stage: NomadPageLoadStage;
      progress?: number;
      dataSize?: number;
    }
  | { type: 'nomadIdentityResult'; requestId: string; ok: boolean; code?: string }
  | { type: 'nomadPageFailed'; requestId: string; code: string }
  | { type: 'destinationPathStatuses'; statuses: DestinationPathStatus[] }
  | {
      type: 'chatAnnounce';
      identityId: string;
      destinationHash: string;
      identityHash: string;
      publicKey: string;
      displayName?: string;
      stampCost?: number;
      compressionSupported?: boolean;
      interfaceId?: string;
      hops?: number;
      heardAt: string;
    }
  | {
      type: 'chatMessageReceived';
      identityId: string;
      messageId: string;
      sourceHash: string;
      destinationHash: string;
      title: string;
      content: string;
      attachments?: ChatAttachment[];
      method?: string;
      verification?: string;
      timestamp?: number;
      receivedAt: string;
    }
  | { type: 'runtimeError'; code: string };
