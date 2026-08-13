import { get, writable } from 'svelte/store';
import type {
  ChatBlockedDestination,
  ChatContact,
  ChatAttachment,
  ChatInboundTransfer,
  ChatMessage,
} from '../../domain/chat';
import { normalizeChatAttachments } from '../../domain/chat-attachments';
import { assignChatMessageOrdering } from '../../domain/chat-ordering';
import {
  chatMessageActivityTime,
  chatDeliveryRepresentation,
  chatMessageDisplayStatus,
  chatMessagePeerHash,
  chatMessageProgressStatus,
  chatMessageStatusForState,
  isUnconfirmedPacket,
  shouldUsePropagationFallback,
  upsertChatBlockedDestination,
  upsertChatContact,
  upsertChatMessage,
} from '../../domain/chat';
import type {
  IdentitySummary,
  ParsedIdentityBackup,
  PersistedIdentityRecord,
} from '../../domain/identity';
import { identitySummary, upsertIdentitySummary as upsertSummaryInList } from '../../domain/identity';
import {
  orphanedKnownDestinationHashes,
  upsertKnownDestination,
  type KnownDestinationRecord,
} from '../../domain/known-destination';
import type { InterfaceAnnounceHistoryRecord } from '../../domain/interface-announce';
import type { ReticulumLogEntry } from '../../domain/logging';
import type {
  NomadBookmark,
  NomadPage,
  NomadPageLoadUpdate,
  NomadRequestData,
  NomadIdentificationPolicy,
} from '../../domain/nomadnet';
import {
  sortProvisioningBookmarks,
  type ProvisioningBookmark,
  type ProvisioningNode,
} from '../../domain/provisioning';
import {
  formatNomadAddress,
  nomadPageLoadDeadlineMs,
  nomadRequestPath,
  parseNomadAddress,
  sortNomadBookmarks,
} from '../../domain/nomadnet';
import {
  defaultAppPreferences,
  normalizeDestinationHash,
  sortInterfaceConfigurations,
  type AppPreferences,
  type InterfaceConfig,
} from '../../domain/settings';
import { t } from '../../i18n';
import { BrowserIdentityRepository } from '../database/identity-repository';
import { BrowserChatRepository } from '../database/chat-repository';
import { BrowserNomadRepository } from '../database/nomad-repository';
import { BrowserSettingsRepository } from '../database/settings-repository';
import { BrowserNetworkStateRepository } from '../database/network-state-repository';
import { BrowserProvisioningRepository } from '../database/provisioning-repository';
import { BrowserKnownDestinationRepository } from '../database/known-destination-repository';
import { BrowserInterfaceAnnounceHistoryRepository } from '../database/interface-announce-history-repository';
import { runtimeInterfaceConfigurations } from '../platform/interface-capabilities';
import { PlatformInterfaceHost } from '../platform/interface-host';
import type {
  ChatMessageQueueResult,
  DestinationPathRequestResult,
  DestinationPathStatus,
  KnownDestinationEntry,
  LocalDestinationEntry,
  InterfaceRuntimeState,
  LxmfPropagationSyncResult,
  LxmfPropagationSyncStatus,
  NomadLinkStatus,
  PathTableEntry,
  ProbeResult,
  RuntimeCommand,
  RuntimeConfiguration,
  RuntimeEvent,
  RuntimeStatusDetails,
  RuntimeState,
  ProvisioningRequestStage,
} from './protocol';
import { maximumProbePayloadBytes } from './protocol';
import { pathRequestTimeoutMs } from './timeouts';
import {
  chatDirectoryReady,
  blockedChatDestinations,
  chatContacts,
  chatMessages,
  emitAutomaticPropagationSyncComplete,
  emitIncomingChatMessage,
  forgetUnreadChatMessages,
  markChatMessagesRead,
  noteUnreadChatMessage,
  unreadChatMessageCount,
} from './chat-state';

export {
  blockedChatDestinations,
  chatContacts,
  chatDirectoryReady,
  chatMessages,
  unreadChatMessageCount,
} from './chat-state';

export const runtimeStatus = writable<RuntimeState>('starting');
export const appPreferences = writable<AppPreferences>(structuredClone(defaultAppPreferences));
export const interfaceConfigurations = writable<InterfaceConfig[]>([]);
export const chatInboundTransfers = writable<ChatInboundTransfer[]>([]);
export const interfaceStatuses = writable<Record<string, InterfaceRuntimeState>>({});
export const statusDetails = writable<RuntimeStatusDetails | undefined>();
export const activeIdentity = writable<IdentitySummary | undefined>();
export const identities = writable<IdentitySummary[]>([]);
export const deliveryDestinationHash = writable<string | undefined>();
export const runtimeErrorCode = writable<string | undefined>();
export const propagationSyncActive = writable(false);
export const propagationSyncStatus = writable<LxmfPropagationSyncStatus>({ syncing: false });
export const nomadBookmarks = writable<NomadBookmark[]>([]);
export const nomadDirectoryReady = writable(false);
export const nomadLinkStatuses = writable<Record<string, NomadLinkStatus>>({});
export const provisioningBookmarks = writable<ProvisioningBookmark[]>([]);
export const destinationPathStatuses = writable<Record<string, DestinationPathStatus>>({});
export const pathTableEntries = writable<PathTableEntry[]>([]);
export const remoteDestinationInventory = writable<KnownDestinationEntry[]>([]);
export const localDestinationInventory = writable<LocalDestinationEntry[]>([]);
export const knownDestinations = writable<KnownDestinationRecord[]>([]);
export const reticulumLogs = writable<ReticulumLogEntry[]>([]);

export function clearReticulumLogs(): void {
  reticulumLogs.set([]);
}

export class ProvisioningRequestFailure extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'ProvisioningRequestFailure';
  }
}

function appendLocalLog(
  level: ReticulumLogEntry['level'],
  source: ReticulumLogEntry['source'],
  code: string,
  details?: ReticulumLogEntry['details'],
): void {
  const entry: ReticulumLogEntry = {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    level,
    source,
    code,
    details,
  };
  reticulumLogs.update((items) => [...items.slice(-499), entry]);
}

class ReticulumRuntimeController {
  private worker?: Worker;
  private started = false;
  private readonly identityRepository = new BrowserIdentityRepository();
  private readonly chatRepository = new BrowserChatRepository();
  private readonly nomadRepository = new BrowserNomadRepository();
  private readonly settingsRepository = new BrowserSettingsRepository();
  private readonly networkStateRepository = new BrowserNetworkStateRepository();
  private readonly provisioningRepository = new BrowserProvisioningRepository();
  private readonly knownDestinationRepository = new BrowserKnownDestinationRepository();
  private readonly interfaceAnnounceHistoryRepository = new BrowserInterfaceAnnounceHistoryRepository();
  private interfaceAnnounceHistoryPersistenceQueue = Promise.resolve();
  private knownDestinationPersistenceQueue = Promise.resolve();
  private expectedKnownIdentityInventoryStartupId?: string;
  private readonly platformInterfaceHost = new PlatformInterfaceHost(
    (command) => this.post(command),
    (code, details) => appendLocalLog('debug', 'runtime', code, details),
  );
  private loadedNomadIdentityId?: string;
  private loadedChatIdentityId?: string;
  private messageRetentionTimer?: number;
  private readonly identityNameWaiters = new Map<string, (ok: boolean) => void>();
  private readonly identityOperationWaiters = new Map<string, (ok: boolean) => void>();
  private readonly identityExportWaiters = new Map<string, (value: Uint8Array | undefined) => void>();
  private readonly announceWaiters = new Map<string, (ok: boolean) => void>();
  private readonly messageWaiters = new Map<string, (result: ChatMessageQueueResult) => void>();
  private readonly messageOperationWaiters = new Map<string, (ok: boolean) => void>();
  private readonly ignoredDestinationsWaiters = new Map<string, (ok: boolean) => void>();
  private readonly lxmaPeerWaiters = new Map<string, (destinationHash: string | undefined) => void>();
  private readonly deletingChatMessageIds = new Set<string>();
  private readonly propagationSyncWaiters = new Map<string, (result: LxmfPropagationSyncResult | undefined) => void>();
  private readonly pendingPropagationMessagePersistence = new Set<Promise<void>>();
  private readonly nomadPageWaiters = new Map<string, {
    resolve: (page: NomadPage | undefined) => void;
    onUpdate?: (update: NomadPageLoadUpdate) => void;
  }>();
  private readonly nomadLinkWaiters = new Map<string, (ok: boolean) => void>();
  private readonly nomadIdentityWaiters = new Map<string, (ok: boolean) => void>();
  private readonly provisioningWaiters = new Map<string, {
    resolve: (data: Uint8Array) => void;
    reject: (error: ProvisioningRequestFailure) => void;
    onUpdate?: (stage: ProvisioningRequestStage, progress?: number, dataSize?: number) => void;
  }>();
  private readonly probeWaiters = new Map<string, {
    resolve: (result: ProbeResult) => void;
    destinationHash: string;
    fullDestinationName: string;
    probeSizeBytes: number;
    cleanup?: () => void;
  }>();
  private readonly pathDropWaiters = new Map<string, (ok: boolean) => void>();
  private readonly pathManagementWaiters = new Map<string, (ok: boolean) => void>();
  private readonly pathRequestWaiters = new Map<string, {
    destinationHash: string;
    resolve: (result: DestinationPathRequestResult) => void;
    cleanup?: () => void;
  }>();
  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    runtimeStatus.set('starting');
    nomadDirectoryReady.set(false);
    nomadLinkStatuses.set({});
    chatDirectoryReady.set(false);

    try {
      const [
        wrappingKey,
        identity,
        storedIdentities,
        settings,
        networkState,
        storedProvisioningBookmarks,
        storedKnownDestinations,
      ] = await Promise.all([
        this.identityRepository.getOrCreateWrappingKey(),
        this.identityRepository.loadActiveIdentity(),
        this.identityRepository.loadAll(),
        this.settingsRepository.load(),
        this.networkStateRepository.load(),
        this.provisioningRepository.loadBookmarks(),
        this.enqueueKnownDestinationPersistence(() => this.knownDestinationRepository.loadAll()),
      ]);
      identities.set(storedIdentities.map(identitySummary));
      appPreferences.set(structuredClone(settings.preferences));
      interfaceConfigurations.set(structuredClone(settings.interfaces));
      this.scheduleMessageRetention();
      provisioningBookmarks.set(storedProvisioningBookmarks);
      knownDestinations.set(storedKnownDestinations);
      const startupId = crypto.randomUUID();
      this.expectedKnownIdentityInventoryStartupId = startupId;
      const worker = new Worker(new URL('../../workers/reticulum.worker.ts', import.meta.url), { type: 'module' });
      this.worker = worker;
      worker.onmessage = (message: MessageEvent<RuntimeEvent>) => void this.handleEvent(message.data);
      worker.onerror = () => {
        this.expectedKnownIdentityInventoryStartupId = undefined;
        runtimeErrorCode.set('RUNTIME_WORKER_FAILED');
        runtimeStatus.set('error');
        propagationSyncActive.set(false);
        propagationSyncStatus.set({ syncing: false });
        for (const resolve of this.propagationSyncWaiters.values()) resolve(undefined);
        this.propagationSyncWaiters.clear();
        for (const resolve of this.lxmaPeerWaiters.values()) resolve(undefined);
        this.lxmaPeerWaiters.clear();
        for (const waiter of this.provisioningWaiters.values()) waiter.reject(new ProvisioningRequestFailure('PROVISIONING_RUNTIME_FAILED'));
        this.provisioningWaiters.clear();
        this.failProbeWaiters('PROBE_RUNTIME_FAILED');
        for (const resolve of this.pathDropWaiters.values()) resolve(false);
        this.pathDropWaiters.clear();
        for (const resolve of this.pathManagementWaiters.values()) resolve(false);
        this.pathManagementWaiters.clear();
        this.failPathRequestWaiters('PATH_REQUEST_RUNTIME_FAILED');
        pathTableEntries.set([]);
        remoteDestinationInventory.set([]);
        localDestinationInventory.set([]);
      };

      let blockedDestinationHashes: string[] = [];
      let contactDestinationHashes: string[] = [];
      let interfaceAnnounceHistory: InterfaceAnnounceHistoryRecord[] = [];
      if (identity) {
        const [, chatDirectory, storedInterfaceAnnounceHistory] = await Promise.all([
          this.loadNomadDirectory(identity.id),
          this.chatRepository.load(identity.id),
          this.interfaceAnnounceHistoryRepository.load(identity.id),
        ]);
        blockedDestinationHashes = chatDirectory.blockedDestinations.map((item) => item.destinationHash);
        contactDestinationHashes = chatDirectory.contacts.map((item) => item.destinationHash);
        interfaceAnnounceHistory = storedInterfaceAnnounceHistory;
      }

      this.post({
        type: 'initialize',
        startupId,
        wrappingKey,
        identity,
        networkState,
        blockedDestinationHashes,
        contactDestinationHashes,
        interfaceAnnounceHistory,
        newIdentity: {
          id: crypto.randomUUID(),
          label: '',
          displayName: '',
        },
        configuration: {
          preferences: settings.preferences,
          interfaces: runtimeInterfaceConfigurations(settings.interfaces),
        },
      });
    } catch {
      this.expectedKnownIdentityInventoryStartupId = undefined;
      if (this.messageRetentionTimer !== undefined) {
        window.clearInterval(this.messageRetentionTimer);
        this.messageRetentionTimer = undefined;
      }
      runtimeErrorCode.set('RUNTIME_INITIALIZATION_FAILED');
      runtimeStatus.set('error');
    }
  }

  async applyConfiguration(preferences: AppPreferences, interfaces: InterfaceConfig[]): Promise<void> {
    const orderedInterfaces = sortInterfaceConfigurations(interfaces);
    const configuration: RuntimeConfiguration = {
      preferences: structuredClone(preferences),
      interfaces: structuredClone(runtimeInterfaceConfigurations(orderedInterfaces)),
    };
    appPreferences.set(structuredClone(preferences));
    interfaceConfigurations.set(structuredClone(orderedInterfaces));
    await this.pruneExpiredChatMessages();
    this.post({ type: 'applyConfiguration', configuration });
  }

  closeAllLinks(): void {
    this.post({ type: 'closeAllLinks' });
  }

  async announceLxmf(): Promise<boolean> {
    if (!this.worker || !get(activeIdentity)) return false;
    const requestId = crypto.randomUUID();
    this.post({ type: 'announceLxmf', requestId });
    return new Promise((resolve) => {
      const timeout = window.setTimeout(() => {
        this.announceWaiters.delete(requestId);
        resolve(false);
      }, 10_000);
      this.announceWaiters.set(requestId, (ok) => {
        window.clearTimeout(timeout);
        resolve(ok);
      });
    });
  }

  /**
   * Recalls the identity associated with `destination`, derives the destination
   * hash for `fullDestinationName`, then sends one encrypted raw Reticulum
   * packet and waits for its delivery proof. This permits a hash announced for
   * one aspect (for example remote management) to address another aspect on
   * the same identity (for example `rnstransport.probe`). `timeoutMs` covers
   * the proof wait; uncached paths use the separate shared path-request timeout.
   */
  async probeDestination(
    destination: string,
    fullDestinationName: string,
    timeoutMs: number,
    probeSizeBytes: number,
    signal?: AbortSignal,
  ): Promise<ProbeResult> {
    const destinationHash = normalizeDestinationHash(destination);
    const normalizedName = fullDestinationName.trim();
    const validName = normalizedName.length > 0
      && normalizedName.split('.').every((component) => component.length > 0);
    const validTimeout = Number.isSafeInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 2_147_483_647;
    const validSize = Number.isSafeInteger(probeSizeBytes)
      && probeSizeBytes >= 0
      && probeSizeBytes <= maximumProbePayloadBytes;
    if (!this.worker || !get(activeIdentity) || !destinationHash || !validName || !validTimeout || !validSize) {
      return {
        ok: false,
        destinationHash: destinationHash ?? destination.trim().toLowerCase(),
        fullDestinationName: normalizedName,
        probeSizeBytes,
        code: 'PROBE_INVALID',
      };
    }
    if (signal?.aborted) {
      return {
        ok: false,
        destinationHash,
        fullDestinationName: normalizedName,
        probeSizeBytes,
        code: 'PROBE_CANCELLED',
      };
    }

    const requestId = crypto.randomUUID();
    this.post({
      type: 'probeDestination',
      requestId,
      destinationHash,
      fullDestinationName: normalizedName,
      timeoutMs,
      probeSizeBytes,
    });
    return new Promise((resolve) => {
      const abort = () => {
        const waiter = this.probeWaiters.get(requestId);
        if (!waiter) return;
        this.probeWaiters.delete(requestId);
        waiter.cleanup?.();
        this.post({ type: 'cancelProbe', requestId });
        resolve({
          ok: false,
          destinationHash,
          fullDestinationName: normalizedName,
          probeSizeBytes,
          code: 'PROBE_CANCELLED',
        });
      };
      this.probeWaiters.set(requestId, {
        resolve,
        destinationHash,
        fullDestinationName: normalizedName,
        probeSizeBytes,
        ...(signal ? { cleanup: () => signal.removeEventListener('abort', abort) } : {}),
      });
      signal?.addEventListener('abort', abort, { once: true });
    });
  }

  async dropDestinationPath(destination: string): Promise<boolean> {
    const destinationHash = normalizeDestinationHash(destination);
    if (!this.worker || !get(activeIdentity) || !destinationHash) return false;
    const requestId = crypto.randomUUID();
    this.post({ type: 'dropDestinationPath', requestId, destinationHash });
    return new Promise((resolve) => {
      const timeout = window.setTimeout(() => {
        this.pathDropWaiters.delete(requestId);
        resolve(false);
      }, 10_000);
      this.pathDropWaiters.set(requestId, (ok) => {
        window.clearTimeout(timeout);
        resolve(ok);
      });
    });
  }

  async requestDestinationPath(destination: string, signal?: AbortSignal): Promise<DestinationPathRequestResult> {
    const destinationHash = normalizeDestinationHash(destination);
    if (!this.worker || !get(activeIdentity) || !destinationHash) {
      return {
        ok: false,
        destinationHash: destinationHash ?? destination.trim().toLowerCase(),
        code: 'PATH_REQUEST_INVALID',
      };
    }
    if (signal?.aborted) {
      return { ok: false, destinationHash, code: 'PATH_REQUEST_CANCELLED' };
    }
    const requestId = crypto.randomUUID();
    return new Promise((resolve) => {
      const abort = () => {
        const waiter = this.pathRequestWaiters.get(requestId);
        if (!waiter) return;
        this.pathRequestWaiters.delete(requestId);
        window.clearTimeout(timeout);
        waiter.cleanup?.();
        this.post({ type: 'cancelDestinationPathRequest', requestId });
        resolve({ ok: false, destinationHash, code: 'PATH_REQUEST_CANCELLED' });
      };
      const timeout = window.setTimeout(() => {
        const waiter = this.pathRequestWaiters.get(requestId);
        if (!waiter) return;
        this.pathRequestWaiters.delete(requestId);
        waiter.cleanup?.();
        resolve({ ok: false, destinationHash, code: 'PATH_REQUEST_BRIDGE_TIMEOUT' });
      }, pathRequestTimeoutMs + 5_000);
      this.pathRequestWaiters.set(requestId, {
        destinationHash,
        resolve: (result) => {
          window.clearTimeout(timeout);
          signal?.removeEventListener('abort', abort);
          resolve(result);
        },
        ...(signal ? { cleanup: () => signal.removeEventListener('abort', abort) } : {}),
      });
      signal?.addEventListener('abort', abort, { once: true });
      this.post({ type: 'requestDestinationPath', requestId, destinationHash });
    });
  }

  async clearDestinationPaths(): Promise<boolean> {
    return this.performPathManagementOperation('clearDestinationPaths');
  }

  async forgetKnownDestination(destination: string): Promise<boolean> {
    const destinationHash = normalizeDestinationHash(destination);
    if (!destinationHash) return false;
    const forgotten = await this.performPathManagementOperation(
      'forgetKnownDestination',
      destinationHash,
    );
    if (!forgotten) return false;
    await this.enqueueKnownDestinationPersistence(
      () => this.knownDestinationRepository.delete(destinationHash),
    );
    knownDestinations.update((records) => (
      records.filter((record) => record.destinationHash !== destinationHash)
    ));
    return true;
  }

  async clearKnownDestinations(): Promise<boolean> {
    const cleared = await this.performPathManagementOperation('clearKnownDestinations');
    if (!cleared) return false;
    await this.enqueueKnownDestinationPersistence(
      () => this.knownDestinationRepository.clear(),
    );
    knownDestinations.set([]);
    return true;
  }

  async syncLxmfPropagation(): Promise<LxmfPropagationSyncResult | undefined> {
    if (!this.worker || !get(activeIdentity)) return undefined;
    const requestId = crypto.randomUUID();
    this.post({ type: 'syncLxmfPropagation', requestId });
    return new Promise((resolve) => {
      this.propagationSyncWaiters.set(requestId, (result) => {
        resolve(result);
      });
    });
  }

  requestAutomaticLxmfPropagationSync(): boolean {
    if (!this.worker || !get(activeIdentity) || get(propagationSyncActive)) return false;
    this.post({
      type: 'syncLxmfPropagation',
      requestId: `automatic:resume:${crypto.randomUUID()}`,
    });
    return true;
  }

  async sendChatMessage(
    destinationHash: string,
    content: string,
    title = '',
    attachments: ChatAttachment[] = [],
  ): Promise<ChatMessageQueueResult> {
    const normalizedDestination = normalizeDestinationHash(destinationHash);
    const normalizedContent = content.trim();
    let normalizedAttachments: ChatAttachment[];
    try {
      normalizedAttachments = normalizeChatAttachments(attachments);
    } catch (error) {
      return { ok: false, code: error instanceof Error ? error.message : 'LXMF_ATTACHMENTS_INVALID' };
    }
    if (!this.worker || !get(activeIdentity) || !normalizedDestination
      || (!normalizedContent && normalizedAttachments.length === 0)) {
      return { ok: false, code: 'LXMF_MESSAGE_INVALID' };
    }
    if (this.isChatDestinationBlocked(normalizedDestination)) {
      return { ok: false, code: 'LXMF_DESTINATION_BLOCKED' };
    }
    const requestId = crypto.randomUUID();
    this.post({
      type: 'sendLxmfMessage',
      requestId,
      destinationHash: normalizedDestination,
      title: title.trim(),
      content: normalizedContent,
      attachments: normalizedAttachments,
    });
    return new Promise((resolve) => {
      const timeout = window.setTimeout(() => {
        this.messageWaiters.delete(requestId);
        resolve({ ok: false, code: 'LXMF_MESSAGE_QUEUE_TIMEOUT' });
      }, 15_000);
      this.messageWaiters.set(requestId, (result) => {
        window.clearTimeout(timeout);
        resolve(result);
      });
    });
  }

  async importLxmaPeer(uri: string): Promise<string | undefined> {
    if (!this.worker || !get(activeIdentity) || !uri.trim()) return undefined;
    const requestId = crypto.randomUUID();
    this.post({ type: 'importLxmaPeer', requestId, uri: uri.trim() });
    return new Promise((resolve) => {
      const timeout = window.setTimeout(() => {
        this.lxmaPeerWaiters.delete(requestId);
        resolve(undefined);
      }, 5_000);
      this.lxmaPeerWaiters.set(requestId, (destinationHash) => {
        window.clearTimeout(timeout);
        resolve(destinationHash);
      });
    });
  }

  async deleteChatMessage(messageId: string): Promise<boolean> {
    const identity = get(activeIdentity);
    const message = get(chatMessages).find((item) => (
      item.identityId === identity?.id && item.messageId === messageId
    ));
    if (!identity || !message) return false;

    this.deletingChatMessageIds.add(message.messageId);
    try {
      const displayStatus = chatMessageDisplayStatus(message);
      if (message.direction === 'outgoing'
        && (displayStatus === 'resolving' || displayStatus === 'queued' || displayStatus === 'sending')) {
        if (!await this.cancelChatMessageDelivery(message.messageId)) return false;
      }
      await this.chatRepository.deleteMessage(message.id);
      chatMessages.update((items) => items.filter((item) => item.id !== message.id));
      appendLocalLog('info', 'persistence', 'CHAT_MESSAGE_DELETED', { messageId: message.messageId });
      return true;
    } catch {
      appendLocalLog('error', 'persistence', 'CHAT_MESSAGE_DELETE_FAILED', { messageId: message.messageId });
      return false;
    } finally {
      this.deletingChatMessageIds.delete(message.messageId);
    }
  }

  async abortChatMessage(messageId: string): Promise<boolean> {
    const identity = get(activeIdentity);
    const message = get(chatMessages).find((item) => (
      item.identityId === identity?.id && item.messageId === messageId
    ));
    const displayStatus = message ? chatMessageDisplayStatus(message) : undefined;
    if (!identity || !message || message.direction !== 'outgoing'
      || (displayStatus !== 'resolving' && displayStatus !== 'queued' && displayStatus !== 'sending')) return false;

    try {
      if (!await this.cancelChatMessageDelivery(message.messageId)) return false;

      // The worker normally emits `cancelled` before acknowledging the
      // operation. Keep this fallback for a terminal-state race where the
      // router no longer has the message but the persisted UI record is still
      // pending.
      const current = get(chatMessages).find((item) => item.id === message.id);
      const currentStatus = current ? chatMessageDisplayStatus(current) : undefined;
      if (current && (currentStatus === 'resolving' || currentStatus === 'queued' || currentStatus === 'sending')) {
        const failed: ChatMessage = {
          ...current,
          status: 'failed',
          progress: undefined,
          propagationFallbackPending: false,
        };
        chatMessages.update((items) => upsertChatMessage(items, failed));
        await this.chatRepository.saveMessage(failed);
      }
      appendLocalLog('info', 'runtime', 'CHAT_MESSAGE_ABORTED', { messageId: message.messageId });
      return true;
    } catch {
      appendLocalLog('warning', 'runtime', 'CHAT_MESSAGE_ABORT_FAILED', { messageId: message.messageId });
      return false;
    }
  }

  async deleteChatConversation(destinationHash: string): Promise<boolean> {
    const identity = get(activeIdentity);
    const normalizedDestination = normalizeDestinationHash(destinationHash);
    if (!identity || !normalizedDestination) return false;
    const messages = get(chatMessages).filter((message) => (
      message.identityId === identity.id && chatMessagePeerHash(message) === normalizedDestination
    ));
    if (messages.length === 0) return false;

    for (const message of messages) this.deletingChatMessageIds.add(message.messageId);
    try {
      const pending = messages.filter((message) => {
        const status = chatMessageDisplayStatus(message);
        return message.direction === 'outgoing'
          && (status === 'resolving' || status === 'queued' || status === 'sending');
      });
      const cancellations = await Promise.all(
        pending.map((message) => this.cancelChatMessageDelivery(message.messageId)),
      );
      if (cancellations.some((cancelled) => !cancelled)) return false;

      const recordIds = new Set(messages.map((message) => message.id));
      await this.chatRepository.deleteMessages([...recordIds]);
      chatMessages.update((items) => items.filter((item) => !recordIds.has(item.id)));
      markChatMessagesRead(normalizedDestination);
      appendLocalLog('info', 'persistence', 'CHAT_CONVERSATION_DELETED', {
        destinationHash: normalizedDestination,
        messages: messages.length,
        cancelled: pending.length,
      });
      return true;
    } catch {
      appendLocalLog('error', 'persistence', 'CHAT_CONVERSATION_DELETE_FAILED', {
        destinationHash: normalizedDestination,
      });
      return false;
    } finally {
      for (const message of messages) this.deletingChatMessageIds.delete(message.messageId);
    }
  }

  async retryChatMessage(messageId: string): Promise<ChatMessageQueueResult> {
    const identity = get(activeIdentity);
    const message = get(chatMessages).find((item) => (
      item.identityId === identity?.id && item.messageId === messageId
    ));
    if (!this.worker || !identity || !message || message.direction !== 'outgoing'
      || chatMessageDisplayStatus(message) !== 'failed') {
      return { ok: false, code: 'LXMF_MESSAGE_RETRY_INVALID' };
    }
    if (this.isChatDestinationBlocked(message.destinationHash)) {
      return { ok: false, code: 'LXMF_DESTINATION_BLOCKED' };
    }
    const requestId = crypto.randomUUID();
    this.post({
      type: 'sendLxmfMessage',
      requestId,
      destinationHash: message.destinationHash,
      title: message.title,
      content: message.content,
      attachments: message.attachments,
      replacesMessageId: message.messageId,
      ...(message.timestamp === undefined ? {} : { timestamp: message.timestamp }),
    });
    return new Promise((resolve) => {
      const timeout = window.setTimeout(() => {
        this.messageWaiters.delete(requestId);
        resolve({ ok: false, code: 'LXMF_MESSAGE_QUEUE_TIMEOUT' });
      }, 15_000);
      this.messageWaiters.set(requestId, (result) => {
        window.clearTimeout(timeout);
        resolve(result);
      });
    });
  }

  private async cancelChatMessageDelivery(messageId: string): Promise<boolean> {
    if (!this.worker) return false;
    const requestId = crypto.randomUUID();
    this.post({ type: 'cancelLxmfMessage', requestId, messageId });
    return new Promise((resolve) => {
      const timeout = window.setTimeout(() => {
        this.messageOperationWaiters.delete(requestId);
        resolve(false);
      }, 10_000);
      this.messageOperationWaiters.set(requestId, (ok) => {
        window.clearTimeout(timeout);
        resolve(ok);
      });
    });
  }

  private queuePropagationFallback(message: ChatMessage): void {
    if (!this.worker || message.direction !== 'outgoing' || typeof message.timestamp !== 'number'
      || this.isChatDestinationBlocked(message.destinationHash)) return;
    const requestId = crypto.randomUUID();
    this.post({
      type: 'sendLxmfMessage',
      requestId,
      destinationHash: message.destinationHash,
      title: message.title,
      content: message.content,
      attachments: message.attachments,
      propagationFallback: true,
      replacesMessageId: message.messageId,
      timestamp: message.timestamp,
    });
    appendLocalLog('info', 'runtime', 'CHAT_OUTBOUND_PROPAGATION_FALLBACK_REQUESTED', {
      messageId: message.messageId,
      destinationHash: message.destinationHash,
    });
  }

  async saveChatContact(destinationHash: string, name: string): Promise<boolean> {
    const identity = get(activeIdentity);
    const normalizedDestination = normalizeDestinationHash(destinationHash);
    const normalizedName = name.trim();
    if (!identity || !normalizedDestination || !normalizedName) return false;
    const existing = get(chatContacts).find((item) => (
      item.identityId === identity.id && item.destinationHash === normalizedDestination
    ));
    const now = new Date().toISOString();
    const contact: ChatContact = {
      id: `${identity.id}:${normalizedDestination}`,
      identityId: identity.id,
      destinationHash: normalizedDestination,
      name: normalizedName.slice(0, 128),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    try {
      await this.chatRepository.saveContact(contact);
      chatContacts.update((items) => upsertChatContact(items, contact));
      this.syncChatContactDestinationsToWorker();
      this.refreshDestinationPaths([contact.destinationHash]);
      return true;
    } catch {
      runtimeErrorCode.set('RUNTIME_CHAT_PERSIST_FAILED');
      return false;
    }
  }

  async deleteChatContact(contactId: string): Promise<boolean> {
    const identity = get(activeIdentity);
    const contact = get(chatContacts).find((item) => item.id === contactId && item.identityId === identity?.id);
    if (!contact) return false;
    try {
      await this.chatRepository.deleteContact(contact.id);
      chatContacts.update((items) => items.filter((item) => item.id !== contact.id));
      this.syncChatContactDestinationsToWorker();
      return true;
    } catch {
      runtimeErrorCode.set('RUNTIME_CHAT_PERSIST_FAILED');
      return false;
    }
  }

  isChatDestinationBlocked(destinationHash: string): boolean {
    const identity = get(activeIdentity);
    const normalizedDestination = normalizeDestinationHash(destinationHash);
    return Boolean(identity && normalizedDestination && get(blockedChatDestinations).some((item) => (
      item.identityId === identity.id && item.destinationHash === normalizedDestination
    )));
  }

  async blockChatDestination(destinationHash: string): Promise<boolean> {
    const identity = get(activeIdentity);
    const normalizedDestination = normalizeDestinationHash(destinationHash);
    if (!identity || !normalizedDestination) return false;
    if (this.isChatDestinationBlocked(normalizedDestination)) return true;

    const blocked: ChatBlockedDestination = {
      id: `${identity.id}:${normalizedDestination}`,
      identityId: identity.id,
      destinationHash: normalizedDestination,
      blockedAt: new Date().toISOString(),
    };
    const previous = get(blockedChatDestinations);
    const next = upsertChatBlockedDestination(previous, blocked);
    if (!await this.setLxmfIgnoredDestinations(next.map((item) => item.destinationHash))) return false;
    try {
      await this.chatRepository.saveBlockedDestination(blocked);
      blockedChatDestinations.set(next);
      markChatMessagesRead(normalizedDestination);

      const pending = get(chatMessages).filter((message) => {
        const status = chatMessageDisplayStatus(message);
        return message.identityId === identity.id
          && chatMessagePeerHash(message) === normalizedDestination
          && message.direction === 'outgoing'
          && (status === 'resolving' || status === 'queued' || status === 'sending');
      });
      const cancellations = await Promise.all(
        pending.map((message) => this.cancelChatMessageDelivery(message.messageId)),
      );
      if (cancellations.some((cancelled) => !cancelled)) {
        appendLocalLog('warning', 'runtime', 'CHAT_DESTINATION_PENDING_CANCEL_FAILED', {
          destinationHash: normalizedDestination,
        });
      }
      appendLocalLog('info', 'persistence', 'CHAT_DESTINATION_BLOCKED', {
        destinationHash: normalizedDestination,
      });
      return true;
    } catch {
      void this.setLxmfIgnoredDestinations(previous.map((item) => item.destinationHash));
      appendLocalLog('error', 'persistence', 'CHAT_DESTINATION_BLOCK_FAILED', {
        destinationHash: normalizedDestination,
      });
      return false;
    }
  }

  async unblockChatDestination(destinationHash: string): Promise<boolean> {
    const identity = get(activeIdentity);
    const normalizedDestination = normalizeDestinationHash(destinationHash);
    if (!identity || !normalizedDestination) return false;
    const id = `${identity.id}:${normalizedDestination}`;
    const previous = get(blockedChatDestinations);
    const next = previous.filter((item) => item.id !== id);
    if (!await this.setLxmfIgnoredDestinations(next.map((item) => item.destinationHash))) return false;
    try {
      await this.chatRepository.deleteBlockedDestination(id);
      blockedChatDestinations.set(next);
      appendLocalLog('info', 'persistence', 'CHAT_DESTINATION_UNBLOCKED', {
        destinationHash: normalizedDestination,
      });
      return true;
    } catch {
      void this.setLxmfIgnoredDestinations(previous.map((item) => item.destinationHash));
      appendLocalLog('error', 'persistence', 'CHAT_DESTINATION_UNBLOCK_FAILED', {
        destinationHash: normalizedDestination,
      });
      return false;
    }
  }

  async addNomadBookmark(
    address: string,
    label: string,
    identificationPolicy: NomadIdentificationPolicy = 'never',
  ): Promise<boolean> {
    const parsed = parseNomadAddress(address);
    const identity = get(activeIdentity);
    const normalizedLabel = label.trim();
    if (!parsed || !identity || !normalizedLabel) return false;

    const bookmark: NomadBookmark = {
      id: `${identity.id}:${formatNomadAddress(parsed.destinationHash, parsed.path, parsed.requestData)}`,
      identityId: identity.id,
      destinationHash: parsed.destinationHash,
      path: parsed.path,
      requestData: { ...parsed.requestData },
      identificationPolicy,
      label: normalizedLabel,
      createdAt: new Date().toISOString(),
    };
    await this.nomadRepository.saveBookmark(bookmark);
    nomadBookmarks.update((items) => sortNomadBookmarks([
      bookmark,
      ...items.filter((item) => item.id !== bookmark.id),
    ]));
    this.refreshDestinationPaths([bookmark.destinationHash]);
    return true;
  }

  async requestNomadPage(
    destinationHash: string,
    path: string,
    requestData: NomadRequestData = {},
    onUpdate?: (update: NomadPageLoadUpdate) => void,
    freshLink = false,
    identifyBeforeRequest = false,
  ): Promise<NomadPage | undefined> {
    const identity = get(activeIdentity);
    const normalizedDestination = normalizeDestinationHash(destinationHash);
    if (!this.worker || !identity || !normalizedDestination) {
      onUpdate?.({ type: 'failed', code: 'NOMAD_RUNTIME_UNAVAILABLE' });
      return undefined;
    }
    const requestId = crypto.randomUUID();
    return new Promise((resolve) => {
      this.nomadPageWaiters.set(requestId, { resolve, onUpdate });
      this.post({
        type: 'requestNomadPage',
        requestId,
        destinationHash: normalizedDestination,
        path: nomadRequestPath(path),
        requestData,
        ...(freshLink ? { freshLink: true } : {}),
        ...(identifyBeforeRequest ? { identifyBeforeRequest: true } : {}),
      });
    });
  }

  cancelNomadPage(destinationHash: string, closeLink = false): void {
    const normalizedDestination = normalizeDestinationHash(destinationHash);
    if (this.worker && normalizedDestination) {
      this.post({ type: 'cancelNomadPage', destinationHash: normalizedDestination, closeLink });
    }
  }

  async establishNomadLink(destinationHash: string): Promise<boolean> {
    const normalizedDestination = normalizeDestinationHash(destinationHash);
    if (!this.worker || !get(activeIdentity) || !normalizedDestination) return false;
    const requestId = crypto.randomUUID();
    return new Promise((resolve) => {
      const timeout = window.setTimeout(() => {
        this.nomadLinkWaiters.delete(requestId);
        resolve(false);
      }, nomadPageLoadDeadlineMs(Number.MAX_SAFE_INTEGER) + 5_000);
      this.nomadLinkWaiters.set(requestId, (ok) => {
        window.clearTimeout(timeout);
        resolve(ok);
      });
      this.post({ type: 'establishNomadLink', requestId, destinationHash: normalizedDestination });
    });
  }

  async identifyNomadLink(destinationHash: string): Promise<boolean> {
    const normalizedDestination = normalizeDestinationHash(destinationHash);
    if (!this.worker || !get(activeIdentity) || !normalizedDestination) return false;
    const requestId = crypto.randomUUID();
    return new Promise((resolve) => {
      const timeout = window.setTimeout(() => {
        this.nomadIdentityWaiters.delete(requestId);
        resolve(false);
      }, 10_000);
      this.nomadIdentityWaiters.set(requestId, (ok) => {
        window.clearTimeout(timeout);
        resolve(ok);
      });
      this.post({ type: 'identifyNomadLink', requestId, destinationHash: normalizedDestination });
    });
  }

  async requestProvisioning(
    provisioningNode: ProvisioningNode,
    payload: Uint8Array,
    safeToRetry: boolean,
    onUpdate?: (stage: ProvisioningRequestStage, progress?: number, dataSize?: number) => void,
    responseTimeoutMs?: number,
  ): Promise<Uint8Array> {
    const destinationHash = normalizeDestinationHash(provisioningNode.destinationHash);
    if (!this.worker || !get(activeIdentity) || !destinationHash) {
      throw new ProvisioningRequestFailure('PROVISIONING_DESTINATION_UNKNOWN');
    }
    const requestId = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      this.provisioningWaiters.set(requestId, { resolve, reject, onUpdate });
      this.post({
        type: 'requestProvisioning',
        requestId,
        destinationHash,
        payload: new Uint8Array(payload),
        safeToRetry,
        responseTimeoutMs,
      });
    });
  }

  cancelProvisioning(destinationHash: string, closeLink = false): void {
    const normalizedDestination = normalizeDestinationHash(destinationHash);
    if (this.worker && normalizedDestination) {
      this.post({ type: 'cancelProvisioning', destinationHash: normalizedDestination, closeLink });
    }
  }

  closeProvisioning(): void {
    if (this.worker) this.post({ type: 'closeProvisioning' });
  }

  async saveProvisioningNodeBookmark(node: ProvisioningNode, label: string): Promise<boolean> {
    const destinationHash = normalizeDestinationHash(node.destinationHash);
    const normalizedLabel = label.trim();
    if (!destinationHash || !normalizedLabel) return false;
    const existing = get(provisioningBookmarks).find((item) => (
      item.id === node.id || item.destinationHash === destinationHash
    ));
    const now = new Date().toISOString();
    const updated: ProvisioningBookmark = {
      id: existing?.id ?? destinationHash,
      destinationHash,
      label: normalizedLabel,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    await this.provisioningRepository.saveBookmark(updated);
    provisioningBookmarks.update((items) => sortProvisioningBookmarks([
      updated,
      ...items.filter((item) => item.id !== updated.id),
    ]));
    this.refreshDestinationPaths([destinationHash]);
    return true;
  }

  async setProvisioningNodeBookmarked(id: string, bookmarked: boolean, label?: string): Promise<boolean> {
    const existing = get(provisioningBookmarks).find((item) => item.id === id);
    if (!bookmarked) {
      if (!await this.provisioningRepository.deleteBookmark(id)) return false;
      provisioningBookmarks.update((items) => items.filter((item) => item.id !== id));
      return true;
    }
    const normalizedLabel = label?.trim();
    if (!existing || !normalizedLabel) return false;
    const updated: ProvisioningBookmark = {
      ...existing,
      label: normalizedLabel,
      updatedAt: new Date().toISOString(),
    };
    await this.provisioningRepository.saveBookmark(updated);
    provisioningBookmarks.update((items) => sortProvisioningBookmarks(
      items.map((item) => item.id === id ? updated : item),
    ));
    return true;
  }

  async deleteNomadBookmark(id: string): Promise<void> {
    await this.nomadRepository.deleteBookmark(id);
    nomadBookmarks.update((items) => items.filter((item) => item.id !== id));
  }

  async updateNomadBookmark(
    id: string,
    address: string,
    name: string,
    identificationPolicy: NomadIdentificationPolicy,
  ): Promise<boolean> {
    const parsed = parseNomadAddress(address);
    const identity = get(activeIdentity);
    const normalizedName = name.trim();
    const existing = get(nomadBookmarks).find((item) => item.id === id && item.identityId === identity?.id);
    if (!parsed || !existing || !identity || !normalizedName) return false;
    const nextAddress = formatNomadAddress(parsed.destinationHash, parsed.path, parsed.requestData);
    const updated: NomadBookmark = {
      ...existing,
      id: `${identity.id}:${nextAddress}`,
      destinationHash: parsed.destinationHash,
      path: parsed.path,
      requestData: { ...parsed.requestData },
      identificationPolicy,
      label: normalizedName,
    };
    await this.nomadRepository.replaceBookmark(id, updated);
    nomadBookmarks.update((items) => sortNomadBookmarks(items.flatMap((item) => {
      if (item.id === id) return [updated];
      return item.id === updated.id ? [] : [item];
    })));
    this.refreshDestinationPaths([updated.destinationHash]);
    return true;
  }

  async updateActiveIdentityDisplayName(value: string): Promise<boolean> {
    const displayName = value.trim();
    if (!displayName || !get(activeIdentity) || !this.worker) return false;
    const requestId = crypto.randomUUID();
    this.post({ type: 'updateIdentityDisplayName', requestId, displayName });
    return new Promise((resolve) => {
      const timeout = window.setTimeout(() => {
        this.identityNameWaiters.delete(requestId);
        resolve(false);
      }, 10_000);
      this.identityNameWaiters.set(requestId, (ok) => {
        window.clearTimeout(timeout);
        resolve(ok);
      });
    });
  }

  async createIdentity(displayName: string): Promise<boolean> {
    const normalized = displayName.trim();
    if (!normalized || !this.worker) return false;
    const requestId = crypto.randomUUID();
    return this.waitForIdentityOperation(requestId, {
      type: 'createIdentity',
      requestId,
      metadata: {
        id: crypto.randomUUID(),
        label: normalized,
        displayName: normalized,
      },
    });
  }

  async importIdentity(backup: ParsedIdentityBackup, value: string): Promise<boolean> {
    const displayName = value.trim();
    if (!displayName || !this.worker) return false;
    const requestId = crypto.randomUUID();
    const privateKey = Uint8Array.from(backup.privateKey);
    const operation = this.waitForIdentityOperation(requestId, {
      type: 'importIdentity',
      requestId,
      metadata: { id: crypto.randomUUID(), label: displayName, displayName },
      privateKey,
      expectedIdentityHash: backup.expectedIdentityHash,
    });
    privateKey.fill(0);
    return operation;
  }

  async updateIdentityDisplayName(identityId: string, value: string): Promise<boolean> {
    const displayName = value.trim();
    if (!displayName) return false;
    if (get(activeIdentity)?.id === identityId) return this.updateActiveIdentityDisplayName(displayName);
    const record = await this.identityRepository.loadById(identityId);
    if (!record) return false;
    const updated = { ...record, label: displayName, displayName, updatedAt: new Date().toISOString() };
    await this.identityRepository.save(updated);
    this.upsertIdentitySummary(updated);
    return true;
  }

  async activateIdentity(identityId: string): Promise<boolean> {
    if (get(activeIdentity)?.id === identityId || !this.worker) return true;
    const record = await this.identityRepository.loadById(identityId);
    if (!record) return false;
    const [directory, interfaceAnnounceHistory] = await Promise.all([
      this.chatRepository.load(identityId),
      this.interfaceAnnounceHistoryRepository.load(identityId),
    ]);
    const requestId = crypto.randomUUID();
    return this.waitForIdentityOperation(requestId, {
      type: 'activateIdentity',
      requestId,
      identity: record,
      blockedDestinationHashes: directory.blockedDestinations.map((item) => item.destinationHash),
      contactDestinationHashes: directory.contacts.map((item) => item.destinationHash),
      interfaceAnnounceHistory,
    });
  }

  async deleteIdentity(identityId: string): Promise<boolean> {
    if (get(activeIdentity)?.id === identityId) return false;
    try {
      await this.identityRepository.delete(identityId);
      identities.update((items) => items.filter((item) => item.id !== identityId));
      return true;
    } catch {
      return false;
    }
  }

  async exportIdentity(identityId: string): Promise<{ filename: string; content: Uint8Array } | undefined> {
    if (!this.worker) return undefined;
    const record = await this.identityRepository.loadById(identityId);
    if (!record) return undefined;
    const requestId = crypto.randomUUID();
    const privateKey = await new Promise<Uint8Array | undefined>((resolve) => {
      const timeout = window.setTimeout(() => {
        this.identityExportWaiters.delete(requestId);
        resolve(undefined);
      }, 10_000);
      this.identityExportWaiters.set(requestId, (value) => {
        window.clearTimeout(timeout);
        resolve(value);
      });
      this.post({ type: 'exportIdentity', requestId, identity: record });
    });
    if (!privateKey) return undefined;
    const content = Uint8Array.from(privateKey);
    const identityHash = identitySummary(record).identityHashHex;
    privateKey.fill(0);
    return {
      filename: `identity-${identityHash.slice(0, 8)}`,
      content,
    };
  }

  stop(): void {
    nomadDirectoryReady.set(false);
    nomadLinkStatuses.set({});
    chatDirectoryReady.set(false);
    if (this.messageRetentionTimer !== undefined) {
      window.clearInterval(this.messageRetentionTimer);
      this.messageRetentionTimer = undefined;
    }
    if (!this.worker) return;
    this.post({ type: 'shutdown' });
    void this.platformInterfaceHost.closeAll();
    this.worker = undefined;
    this.started = false;
    statusDetails.set(undefined);
    pathTableEntries.set([]);
    remoteDestinationInventory.set([]);
    localDestinationInventory.set([]);
    this.expectedKnownIdentityInventoryStartupId = undefined;
    for (const waiter of this.nomadPageWaiters.values()) waiter.resolve(undefined);
    this.nomadPageWaiters.clear();
    for (const resolve of this.nomadLinkWaiters.values()) resolve(false);
    this.nomadLinkWaiters.clear();
    for (const waiter of this.provisioningWaiters.values()) waiter.reject(new ProvisioningRequestFailure('PROVISIONING_RUNTIME_STOPPED'));
    this.provisioningWaiters.clear();
    for (const resolve of this.nomadIdentityWaiters.values()) resolve(false);
    this.nomadIdentityWaiters.clear();
    for (const resolve of this.propagationSyncWaiters.values()) resolve(undefined);
    this.propagationSyncWaiters.clear();
    propagationSyncActive.set(false);
    propagationSyncStatus.set({ syncing: false });
    for (const resolve of this.messageOperationWaiters.values()) resolve(false);
    this.messageOperationWaiters.clear();
    for (const resolve of this.ignoredDestinationsWaiters.values()) resolve(false);
    this.ignoredDestinationsWaiters.clear();
    this.failProbeWaiters('PROBE_RUNTIME_STOPPED');
    for (const resolve of this.pathDropWaiters.values()) resolve(false);
    this.pathDropWaiters.clear();
    for (const resolve of this.pathManagementWaiters.values()) resolve(false);
    this.pathManagementWaiters.clear();
    this.failPathRequestWaiters('PATH_REQUEST_RUNTIME_STOPPED');
  }

  private async handleEvent(event: RuntimeEvent): Promise<void> {
    if (event.type === 'runtimeLog') {
      reticulumLogs.update((items) => [...items.slice(-499), event.entry]);
      return;
    }
    if (event.type === 'platformInterfaceOpen') {
      await this.platformInterfaceHost.open(event.config);
      return;
    }
    if (event.type === 'platformInterfaceClose') {
      await this.platformInterfaceHost.close(event.id);
      return;
    }
    if (event.type === 'platformInterfaceWrite') {
      await this.platformInterfaceHost.write(event.id, event.data, event.highPriority);
      return;
    }
    if (event.type === 'runtimeStatus') {
      runtimeStatus.set(event.state);
      return;
    }
    if (event.type === 'lxmfPropagationSyncStatus') {
      const progress = event.progress !== undefined && Number.isFinite(event.progress)
        ? Math.min(1, Math.max(0, event.progress))
        : undefined;
      const transferSize = event.transferSize !== undefined && Number.isFinite(event.transferSize)
        ? Math.max(0, event.transferSize)
        : undefined;
      propagationSyncActive.set(event.syncing);
      propagationSyncStatus.set({
        syncing: event.syncing,
        ...(event.state ? { state: event.state } : {}),
        ...(progress !== undefined ? { progress } : {}),
        ...(transferSize !== undefined ? { transferSize } : {}),
      });
      return;
    }
    if (event.type === 'interfaceStatus') {
      interfaceStatuses.update((statuses) => ({ ...statuses, [event.id]: event.state }));
      // Connection failures belong to the individual interface. Drivers retry
      // automatically, and another configured interface may still be online,
      // so they must not become a global Reticulum runtime error banner.
      return;
    }
    if (event.type === 'statusDetails') {
      statusDetails.set(event.details);
      return;
    }
    if (event.type === 'identityReady') {
      if (get(activeIdentity)?.id !== event.identity.id) nomadLinkStatuses.set({});
      activeIdentity.set(identitySummary(event.identity));
      deliveryDestinationHash.set(event.deliveryDestinationHashHex);
      runtimeErrorCode.set(undefined);
      await this.loadNomadDirectory(event.identity.id);
      await this.loadChatDirectory(event.identity.id);
      void this.setLxmfIgnoredDestinations(
        get(blockedChatDestinations).map((item) => item.destinationHash),
      );
      this.syncChatContactDestinationsToWorker();
      this.refreshKnownDestinationPaths();
      return;
    }
    if (event.type === 'destinationPathStatuses') {
      destinationPathStatuses.update((current) => {
        const next = { ...current };
        for (const status of event.statuses) next[status.destinationHash] = status;
        return next;
      });
      return;
    }
    if (event.type === 'pathManagementSnapshot') {
      pathTableEntries.set(event.paths);
      remoteDestinationInventory.set(event.remoteDestinations);
      localDestinationInventory.set(event.localDestinations);
      return;
    }
    if (event.type === 'knownIdentityInventoryReady') {
      if (event.startupId !== this.expectedKnownIdentityInventoryStartupId) return;
      this.expectedKnownIdentityInventoryStartupId = undefined;
      const current = get(knownDestinations);
      const orphanedHashes = orphanedKnownDestinationHashes(current, event.destinationHashes);
      if (orphanedHashes.length === 0) return;
      const orphaned = new Set(orphanedHashes);
      knownDestinations.set(current.filter((record) => !orphaned.has(record.destinationHash)));
      try {
        await this.enqueueKnownDestinationPersistence(
          () => this.knownDestinationRepository.deleteMany(orphanedHashes),
        );
      } catch {
        runtimeErrorCode.set('RUNTIME_KNOWN_DESTINATION_PERSIST_FAILED');
      }
      return;
    }
    if (event.type === 'pathManagementOperationResult') {
      this.pathManagementWaiters.get(event.requestId)?.(event.ok);
      this.pathManagementWaiters.delete(event.requestId);
      return;
    }
    if (event.type === 'destinationPathRequestResult') {
      const { type: _type, requestId, ...result } = event;
      this.pathRequestWaiters.get(requestId)?.resolve(result);
      this.pathRequestWaiters.delete(event.requestId);
      return;
    }
    if (event.type === 'destinationPathDropResult') {
      this.pathDropWaiters.get(event.requestId)?.(event.ok);
      this.pathDropWaiters.delete(event.requestId);
      return;
    }
    if (event.type === 'probeResult') {
      const waiter = this.probeWaiters.get(event.requestId);
      waiter?.cleanup?.();
      waiter?.resolve(event);
      this.probeWaiters.delete(event.requestId);
      return;
    }
    if (event.type === 'knownDestinationObserved') {
      const { type: _type, ...observation } = event;
      const updated = upsertKnownDestination(get(knownDestinations), observation);
      const record = updated.find((item) => item.destinationHash === event.destinationHash);
      knownDestinations.set(updated);
      if (!record) return;
      try {
        await this.enqueueKnownDestinationPersistence(
          () => this.knownDestinationRepository.save(record),
        );
      } catch {
        runtimeErrorCode.set('RUNTIME_KNOWN_DESTINATION_PERSIST_FAILED');
        appendLocalLog('error', 'persistence', 'KNOWN_DESTINATION_PERSIST_FAILED', {
          destinationHash: event.destinationHash,
        });
      }
      return;
    }
    if (event.type === 'provisioningProgress') {
      this.provisioningWaiters.get(event.requestId)?.onUpdate?.(
        event.stage,
        event.progress,
        event.dataSize,
      );
      return;
    }
    if (event.type === 'provisioningResponse') {
      this.provisioningWaiters.get(event.requestId)?.resolve(new Uint8Array(event.data));
      this.provisioningWaiters.delete(event.requestId);
      return;
    }
    if (event.type === 'provisioningFailed') {
      appendLocalLog('warning', 'runtime', event.code, { requestId: event.requestId });
      this.provisioningWaiters.get(event.requestId)?.reject(new ProvisioningRequestFailure(event.code));
      this.provisioningWaiters.delete(event.requestId);
      return;
    }
    if (event.type === 'nomadPageLoaded') {
      this.nomadPageWaiters.get(event.requestId)?.resolve({
        destinationHash: event.destinationHash,
        path: event.path,
        requestData: event.requestData ?? {},
        content: event.content,
        receivedAt: event.receivedAt,
      });
      this.nomadPageWaiters.delete(event.requestId);
      return;
    }
    if (event.type === 'nomadPageProgress') {
      this.nomadPageWaiters.get(event.requestId)?.onUpdate?.({
        type: 'progress',
        stage: event.stage,
        progress: event.progress,
        dataSize: event.dataSize,
      });
      return;
    }
    if (event.type === 'nomadPageFailed') {
      const waiter = this.nomadPageWaiters.get(event.requestId);
      waiter?.onUpdate?.({ type: 'failed', code: event.code });
      waiter?.resolve(undefined);
      this.nomadPageWaiters.delete(event.requestId);
      return;
    }
    if (event.type === 'nomadLinkResult') {
      appendLocalLog('debug', 'runtime', 'NOMAD_LINK_RESULT_RECEIVED', {
        requestId: event.requestId,
        ok: event.ok,
      });
      this.nomadLinkWaiters.get(event.requestId)?.(event.ok);
      this.nomadLinkWaiters.delete(event.requestId);
      if (!event.ok) appendLocalLog('warning', 'runtime', event.code ?? 'NOMAD_LINK_ESTABLISHMENT_FAILED');
      return;
    }
    if (event.type === 'nomadLinkStatusChanged') {
      nomadLinkStatuses.update((statuses) => ({
        ...statuses,
        [event.destinationHash]: {
          active: event.active,
          identified: event.identified,
        },
      }));
      return;
    }
    if (event.type === 'nomadIdentityResult') {
      appendLocalLog('debug', 'runtime', 'NOMAD_IDENTITY_RESULT_RECEIVED', {
        requestId: event.requestId,
        ok: event.ok,
      });
      this.nomadIdentityWaiters.get(event.requestId)?.(event.ok);
      this.nomadIdentityWaiters.delete(event.requestId);
      if (!event.ok) appendLocalLog('warning', 'runtime', event.code ?? 'NOMAD_IDENTITY_SHARE_FAILED');
      return;
    }
    if (event.type === 'lxmaPeerImportResult') {
      this.lxmaPeerWaiters.get(event.requestId)?.(event.ok ? event.destinationHash : undefined);
      this.lxmaPeerWaiters.delete(event.requestId);
      return;
    }
    if (event.type === 'chatMessageResolving') {
      const previousId = event.replacesMessageId ? `${event.identityId}:${event.replacesMessageId}` : undefined;
      const message: ChatMessage = {
        id: `${event.identityId}:${event.messageId}`,
        identityId: event.identityId,
        messageId: event.messageId,
        sourceHash: event.sourceHash,
        destinationHash: event.destinationHash,
        title: event.title,
        content: event.content,
        attachments: event.attachments,
        method: event.method,
        direction: 'outgoing',
        status: 'resolving',
        propagationFallback: event.propagationFallback,
        propagationFallbackPending: false,
        receivedAt: event.queuedAt,
      };
      const orderedMessage = assignChatMessageOrdering(get(chatMessages), message, {
        replacesMessageId: previousId,
      });
      chatMessages.update((items) => upsertChatMessage(
        previousId && previousId !== orderedMessage.id
          ? items.filter((item) => item.id !== previousId)
          : items,
        orderedMessage,
      ));
      try {
        if (previousId) await this.chatRepository.replaceMessage(previousId, orderedMessage);
        else await this.chatRepository.saveMessage(orderedMessage);
        appendLocalLog('debug', 'persistence', 'CHAT_OUTBOUND_RECIPIENT_DISCOVERY_PERSISTED', {
          messageId: orderedMessage.messageId,
        });
      } catch {
        runtimeErrorCode.set('RUNTIME_CHAT_PERSIST_FAILED');
      }
      this.messageWaiters.get(event.requestId)?.({ ok: true });
      this.messageWaiters.delete(event.requestId);
      return;
    }
    if (event.type === 'chatMessageReceived') {
      if (this.isChatDestinationBlocked(event.sourceHash)) {
        appendLocalLog('info', 'runtime', 'CHAT_MESSAGE_BLOCKED', {
          messageId: event.messageId,
          sourceHash: event.sourceHash,
        });
        return;
      }
      this.refreshDestinationPaths([event.sourceHash]);
      const message: ChatMessage = {
        id: `${event.identityId}:${event.messageId}`,
        identityId: event.identityId,
        messageId: event.messageId,
        sourceHash: event.sourceHash,
        destinationHash: event.destinationHash,
        title: event.title,
        content: event.content,
        attachments: event.attachments,
        method: event.method,
        verification: event.verification,
        stamp: event.stamp,
        direction: 'incoming',
        status: 'delivered',
        timestamp: event.timestamp,
        receivedAt: event.receivedAt,
        path: event.path,
      };
      const isNewMessage = !get(chatMessages).some((item) => item.id === message.id);
      const orderedMessage = assignChatMessageOrdering(get(chatMessages), message);
      chatMessages.update((items) => upsertChatMessage(items, orderedMessage));
      if (isNewMessage) {
        noteUnreadChatMessage(orderedMessage.sourceHash, orderedMessage.id);
        emitIncomingChatMessage(orderedMessage);
      }
      let persistence: Promise<void> | undefined;
      try {
        persistence = this.chatRepository.saveMessage(orderedMessage);
        if (orderedMessage.method === 'propagated') {
          this.pendingPropagationMessagePersistence.add(persistence);
        }
        await persistence;
        appendLocalLog('debug', 'persistence', 'CHAT_MESSAGE_PERSISTED', {
          messageId: orderedMessage.messageId,
        });
      } catch {
        runtimeErrorCode.set('RUNTIME_CHAT_PERSIST_FAILED');
        appendLocalLog('error', 'persistence', 'CHAT_MESSAGE_PERSIST_FAILED', {
          messageId: orderedMessage.messageId,
        });
      } finally {
        if (persistence) this.pendingPropagationMessagePersistence.delete(persistence);
      }
      return;
    }
    if (event.type === 'lxmfIgnoredDestinationsResult') {
      this.ignoredDestinationsWaiters.get(event.requestId)?.(event.ok);
      this.ignoredDestinationsWaiters.delete(event.requestId);
      return;
    }
    if (event.type === 'chatMessageQueued') {
      const previousId = event.replacesMessageId ? `${event.identityId}:${event.replacesMessageId}` : undefined;
      const message: ChatMessage = {
        id: `${event.identityId}:${event.messageId}`,
        identityId: event.identityId,
        messageId: event.messageId,
        sourceHash: event.sourceHash,
        destinationHash: event.destinationHash,
        title: event.title,
        content: event.content,
        attachments: event.attachments,
        method: event.method,
        verification: event.verification,
        stamp: event.stamp,
        direction: 'outgoing',
        status: 'queued',
        propagationFallback: event.propagationFallback,
        propagationFallbackPending: event.propagationFallbackPending,
        timestamp: event.timestamp,
        receivedAt: event.queuedAt,
        path: event.path,
      };
      const orderedMessage = assignChatMessageOrdering(get(chatMessages), message, {
        replacesMessageId: previousId,
      });
      chatMessages.update((items) => upsertChatMessage(
        previousId && previousId !== orderedMessage.id
          ? items.filter((item) => item.id !== previousId)
          : items,
        orderedMessage,
      ));
      try {
        if (previousId) await this.chatRepository.replaceMessage(previousId, orderedMessage);
        else await this.chatRepository.saveMessage(orderedMessage);
        appendLocalLog('debug', 'persistence', event.replacesMessageId
          ? 'CHAT_OUTBOUND_PROPAGATION_FALLBACK_PERSISTED'
          : 'CHAT_OUTBOUND_PERSISTED', { messageId: orderedMessage.messageId });
      } catch {
        runtimeErrorCode.set('RUNTIME_CHAT_PERSIST_FAILED');
      }
      this.messageWaiters.get(event.requestId)?.({ ok: true });
      this.messageWaiters.delete(event.requestId);
      return;
    }
    if (event.type === 'chatMessageQueueFailed') {
      appendLocalLog('error', 'wasm', 'CHAT_OUTBOUND_QUEUE_FAILED', { code: event.code });
      this.messageWaiters.get(event.requestId)?.({ ok: false, code: event.code });
      this.messageWaiters.delete(event.requestId);
      return;
    }
    if (event.type === 'chatMessageOperationResult') {
      this.messageOperationWaiters.get(event.requestId)?.(event.ok);
      this.messageOperationWaiters.delete(event.requestId);
      if (!event.ok) appendLocalLog('warning', 'runtime', event.code ?? 'LXMF_MESSAGE_OPERATION_FAILED');
      return;
    }
    if (event.type === 'chatInboundTransfersCleared') {
      chatInboundTransfers.set([]);
      return;
    }
    if (event.type === 'chatInboundTransfer') {
      if (event.state !== 'receiving') {
        chatInboundTransfers.update((items) => items.filter((item) => item.id !== event.transferId));
        return;
      }
      const transfer: ChatInboundTransfer = {
        id: event.transferId,
        ...(event.destinationHash ? { destinationHash: event.destinationHash } : {}),
        progress: Math.min(1, Math.max(0, event.progress)),
        dataSize: Math.max(0, event.dataSize),
        ...(event.transferSize !== undefined ? { transferSize: Math.max(0, event.transferSize) } : {}),
      };
      chatInboundTransfers.update((items) => [
        ...items.filter((item) => item.id !== transfer.id),
        transfer,
      ]);
      return;
    }
    if (event.type === 'chatMessageProgress') {
      if (this.deletingChatMessageIds.has(event.messageId)) return;
      const existing = get(chatMessages).find((item) => (
        item.identityId === event.identityId && item.messageId === event.messageId
      ));
      const representation = chatDeliveryRepresentation(event.representation);
      if (!existing || !representation) return;
      const sentUnconfirmed = isUnconfirmedPacket(representation) && (
        existing.sentUnconfirmed === true || event.state === 'sending' || event.state === 'sent'
      );
      const status = chatMessageProgressStatus(event.state, event.attempts, representation);
      const updated: ChatMessage = {
        ...existing,
        method: event.method,
        representation,
        attempts: event.attempts,
        maxAttempts: event.maxAttempts,
        progress: event.progress,
        stamp: event.stamp ?? existing.stamp,
        path: existing.path ?? event.path,
        sentUnconfirmed,
        status,
      };
      chatMessages.update((items) => upsertChatMessage(items, updated));
      try {
        await this.chatRepository.saveMessage(updated);
      } catch {
        runtimeErrorCode.set('RUNTIME_CHAT_PERSIST_FAILED');
      }
      return;
    }
    if (event.type === 'chatMessageState') {
      if (this.deletingChatMessageIds.has(event.messageId)) return;
      const existing = get(chatMessages).find((item) => (
        item.identityId === event.identityId && item.messageId === event.messageId
      ));
      if (!existing) return;
      const status = chatMessageStatusForState(
        event.state,
        existing.sentUnconfirmed === true && existing.representation === 'opportunisticPacket',
      );
      if (!status) return;
      const cancelled = event.state === 'cancelled';
      const usePropagationFallback = !cancelled && shouldUsePropagationFallback(existing, status);
      const updated: ChatMessage = {
        ...existing,
        status,
        progress: cancelled ? undefined : existing.progress,
        propagationFallbackPending: cancelled || usePropagationFallback
          ? false
          : existing.propagationFallbackPending,
      };
      chatMessages.update((items) => upsertChatMessage(items, updated));
      try {
        await this.chatRepository.saveMessage(updated);
      } catch {
        runtimeErrorCode.set('RUNTIME_CHAT_PERSIST_FAILED');
      }
      if (usePropagationFallback) this.queuePropagationFallback(updated);
      return;
    }
    if (event.type === 'identityDisplayNameResult') {
      this.identityNameWaiters.get(event.requestId)?.(event.ok);
      this.identityNameWaiters.delete(event.requestId);
      if (!event.ok) runtimeErrorCode.set('RUNTIME_IDENTITY_NAME_PERSIST_FAILED');
      return;
    }
    if (event.type === 'lxmfAnnounceResult') {
      this.announceWaiters.get(event.requestId)?.(event.ok);
      this.announceWaiters.delete(event.requestId);
      if (!event.ok) runtimeErrorCode.set('RUNTIME_IDENTITY_ANNOUNCE_FAILED');
      return;
    }
    if (event.type === 'lxmfPropagationSyncResult') {
      const result = event.ok
        ? {
          received: event.received ?? 0,
          duplicates: event.duplicates ?? 0,
          newMessages: event.newMessages
            ?? Math.max(0, (event.received ?? 0) - (event.duplicates ?? 0)),
        }
        : undefined;
      // Message events precede the completion event in a propagation response,
      // but worker messages are handled concurrently while their IndexedDB
      // writes are pending. Do not publish completion until those messages have
      // finished the UI-first ingestion path, so completion notifications cannot
      // overtake the conversation update.
      if (result && this.pendingPropagationMessagePersistence.size > 0) {
        await Promise.allSettled([...this.pendingPropagationMessagePersistence]);
      }
      if (event.requestId.startsWith('automatic:')) {
        if (result) emitAutomaticPropagationSyncComplete(result);
        return;
      }
      this.propagationSyncWaiters.get(event.requestId)?.(result);
      this.propagationSyncWaiters.delete(event.requestId);
      return;
    }
    if (event.type === 'identityCreated') {
      let ok = false;
      try {
        const summary = identitySummary(event.identity);
        const duplicate = get(identities).some((item) => item.identityHashHex === summary.identityHashHex);
        if (!duplicate) {
          await this.identityRepository.save(event.identity);
          this.upsertIdentitySummary(event.identity);
          ok = true;
        }
      } catch {
        runtimeErrorCode.set('RUNTIME_IDENTITY_PERSIST_FAILED');
      }
      this.resolveIdentityOperation(event.requestId, ok);
      return;
    }
    if (event.type === 'identityExported') {
      this.identityExportWaiters.get(event.requestId)?.(event.privateKey);
      this.identityExportWaiters.delete(event.requestId);
      return;
    }
    if (event.type === 'identityActivationStorageRequested') {
      let ok = false;
      try {
        await this.identityRepository.setActive(event.identityId);
        ok = true;
      } catch {
        runtimeErrorCode.set('RUNTIME_IDENTITY_ACTIVATION_FAILED');
      }
      this.post({ type: 'activationStorageResult', requestId: event.requestId, ok });
      return;
    }
    if (event.type === 'identityOperationResult') {
      this.resolveIdentityOperation(event.requestId, event.ok);
      if (!event.ok) {
        this.identityExportWaiters.get(event.requestId)?.(undefined);
        this.identityExportWaiters.delete(event.requestId);
      }
      return;
    }
    if (event.type === 'runtimeError') {
      runtimeErrorCode.set(event.code);
      return;
    }
    if (event.type === 'persistInterfaceAnnounceHistory') {
      const persistence = this.interfaceAnnounceHistoryPersistenceQueue.then(() => (
        this.interfaceAnnounceHistoryRepository.save(event.records)
      ));
      this.interfaceAnnounceHistoryPersistenceQueue = persistence.catch(() => undefined);
      try {
        await persistence;
      } catch {
        appendLocalLog('warning', 'persistence', 'INTERFACE_ANNOUNCE_HISTORY_PERSIST_FAILED', {
          count: event.records.length,
        });
      }
      return;
    }
    if (event.type === 'persistIdentity') {
      let ok = false;
      try {
        if (event.activate) await this.identityRepository.saveAndActivate(event.identity);
        else await this.identityRepository.save(event.identity);
        this.upsertIdentitySummary(event.identity);
        if (event.activate || get(activeIdentity)?.id === event.identity.id) {
          if (get(activeIdentity)?.id !== event.identity.id) nomadLinkStatuses.set({});
          activeIdentity.set(identitySummary(event.identity));
        }
        ok = true;
      } catch {
        runtimeErrorCode.set('RUNTIME_IDENTITY_PERSIST_FAILED');
      }
      this.post({ type: 'persistenceResult', requestId: event.requestId, ok });
      return;
    }
    if (event.type === 'persistNetworkState') {
      let ok = false;
      try {
        await this.networkStateRepository.save(event.networkState);
        ok = true;
      } catch {
        appendLocalLog('error', 'persistence', 'NETWORK_SNAPSHOT_PERSIST_FAILED');
      }
      this.post({ type: 'networkPersistenceResult', requestId: event.requestId, ok });
    }
  }

  private post(command: RuntimeCommand): void {
    if (command.type === 'platformInterfaceData') {
      this.worker?.postMessage(command, [command.data.buffer as ArrayBuffer]);
      return;
    }
    this.worker?.postMessage(command);
  }

  private enqueueKnownDestinationPersistence<T>(operation: () => Promise<T>): Promise<T> {
    const pending = this.knownDestinationPersistenceQueue.then(operation);
    this.knownDestinationPersistenceQueue = pending.then(() => undefined, () => undefined);
    return pending;
  }

  private performPathManagementOperation(
    type: 'clearDestinationPaths' | 'forgetKnownDestination' | 'clearKnownDestinations',
    destination?: string,
  ): Promise<boolean> {
    const destinationHash = destination === undefined ? undefined : normalizeDestinationHash(destination);
    if (!this.worker || !get(activeIdentity) || (destination !== undefined && !destinationHash)) {
      return Promise.resolve(false);
    }
    const requestId = crypto.randomUUID();
    const command = destinationHash
      ? { type, requestId, destinationHash } as RuntimeCommand
      : { type, requestId } as RuntimeCommand;
    this.post(command);
    return new Promise((resolve) => {
      const timeout = window.setTimeout(() => {
        this.pathManagementWaiters.delete(requestId);
        resolve(false);
      }, 15_000);
      this.pathManagementWaiters.set(requestId, (ok) => {
        window.clearTimeout(timeout);
        resolve(ok);
      });
    });
  }

  private failPathRequestWaiters(code: string): void {
    for (const waiter of this.pathRequestWaiters.values()) {
      waiter.resolve({ ok: false, destinationHash: waiter.destinationHash, code });
    }
    this.pathRequestWaiters.clear();
  }

  private waitForIdentityOperation(requestId: string, command: RuntimeCommand): Promise<boolean> {
    return new Promise((resolve) => {
      const timeout = window.setTimeout(() => {
        this.identityOperationWaiters.delete(requestId);
        resolve(false);
      }, 15_000);
      this.identityOperationWaiters.set(requestId, (ok) => {
        window.clearTimeout(timeout);
        resolve(ok);
      });
      this.post(command);
    });
  }

  private resolveIdentityOperation(requestId: string, ok: boolean): void {
    this.identityOperationWaiters.get(requestId)?.(ok);
    this.identityOperationWaiters.delete(requestId);
  }

  private upsertIdentitySummary(record: PersistedIdentityRecord): void {
    const summary = identitySummary(record);
    identities.update((items) => upsertSummaryInList(items, summary));
  }

  private async loadNomadDirectory(identityId: string): Promise<void> {
    if (this.loadedNomadIdentityId === identityId) {
      nomadDirectoryReady.set(true);
      return;
    }
    nomadDirectoryReady.set(false);
    const bookmarks = await this.nomadRepository.loadBookmarks(identityId);
    const activeIdentityId = get(activeIdentity)?.id;
    if (activeIdentityId && activeIdentityId !== identityId) return;
    this.loadedNomadIdentityId = identityId;
    nomadBookmarks.set(bookmarks);
    nomadDirectoryReady.set(true);
  }

  private async loadChatDirectory(identityId: string): Promise<void> {
    if (this.loadedChatIdentityId === identityId) {
      chatDirectoryReady.set(true);
      return;
    }
    chatDirectoryReady.set(false);
    const directory = await this.chatRepository.load(identityId);
    if (get(activeIdentity)?.id !== identityId) return;
    const interruptedResolutions = directory.messages.filter((message) => message.status === 'resolving');
    if (interruptedResolutions.length > 0) {
      const interruptedIds = new Set(interruptedResolutions.map((message) => message.id));
      directory.messages = directory.messages.map((message) => (
        interruptedIds.has(message.id) ? { ...message, status: 'failed' as const } : message
      ));
      try {
        await Promise.all(directory.messages
          .filter((message) => interruptedIds.has(message.id))
          .map((message) => this.chatRepository.saveMessage(message)));
      } catch {
        runtimeErrorCode.set('RUNTIME_CHAT_PERSIST_FAILED');
      }
    }
    if (this.loadedChatIdentityId && this.loadedChatIdentityId !== identityId) markChatMessagesRead();
    this.loadedChatIdentityId = identityId;
    chatContacts.update((liveItems) => liveItems
      .filter((item) => item.identityId === identityId)
      .reduce((items, item) => upsertChatContact(items, item), directory.contacts));
    chatMessages.update((liveItems) => liveItems
      .filter((item) => item.identityId === identityId)
      .reduce((items, item) => upsertChatMessage(items, item), directory.messages));
    blockedChatDestinations.set(directory.blockedDestinations);
    await this.pruneExpiredChatMessages();
    chatDirectoryReady.set(true);
  }

  private scheduleMessageRetention(): void {
    if (this.messageRetentionTimer !== undefined) window.clearInterval(this.messageRetentionTimer);
    this.messageRetentionTimer = window.setInterval(() => {
      void this.pruneExpiredChatMessages();
    }, 60 * 60 * 1_000);
  }

  private async pruneExpiredChatMessages(): Promise<void> {
    const retentionDays = get(appPreferences).chat.messageRetentionDays;
    const identity = get(activeIdentity);
    if (retentionDays === 0 || !identity) return;
    const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1_000;
    const expiredCurrentMessages = get(chatMessages).filter((message) => (
      message.identityId === identity.id
      && Number.isFinite(chatMessageActivityTime(message))
      && chatMessageActivityTime(message) < cutoff
    ));
    const pendingMessages = expiredCurrentMessages.filter((message) => {
      const status = chatMessageDisplayStatus(message);
      return message.direction === 'outgoing'
        && (status === 'resolving' || status === 'queued' || status === 'sending'
          || message.propagationFallbackPending === true);
    });
    for (const message of expiredCurrentMessages) this.deletingChatMessageIds.add(message.messageId);
    try {
      if (this.worker && pendingMessages.length > 0) {
        const cancellations = await Promise.all(
          pendingMessages.map((message) => this.cancelChatMessageDelivery(message.messageId)),
        );
        if (cancellations.some((cancelled) => !cancelled)) {
          appendLocalLog('warning', 'runtime', 'CHAT_EXPIRED_MESSAGE_CANCEL_FAILED', {
            messages: cancellations.filter((cancelled) => !cancelled).length,
          });
        }
      }
      const deletedIds = await this.chatRepository.deleteExpiredMessages(identity.id, cutoff);
      if (deletedIds.length === 0) return;
      const deleted = new Set(deletedIds);
      forgetUnreadChatMessages(
        get(chatMessages).filter((item) => deleted.has(item.id)).map((item) => item.messageId),
      );
      chatMessages.update((items) => items.filter((item) => !deleted.has(item.id)));
      appendLocalLog('info', 'persistence', 'CHAT_EXPIRED_MESSAGES_DELETED', {
        messages: deletedIds.length,
        retentionDays,
      });
    } catch {
      appendLocalLog('error', 'persistence', 'CHAT_EXPIRED_MESSAGE_DELETE_FAILED', {
        retentionDays,
      });
    } finally {
      for (const message of expiredCurrentMessages) this.deletingChatMessageIds.delete(message.messageId);
    }
  }

  private refreshKnownDestinationPaths(): void {
    this.refreshDestinationPaths([
      ...get(knownDestinations).map((item) => item.destinationHash),
      ...get(nomadBookmarks).map((item) => item.destinationHash),
      ...get(chatContacts).map((item) => item.destinationHash),
      ...get(chatMessages).map(chatMessagePeerHash),
      ...get(blockedChatDestinations).map((item) => item.destinationHash),
      ...get(provisioningBookmarks).map((item) => item.destinationHash),
    ]);
  }

  private refreshDestinationPaths(destinationHashes: string[]): void {
    if (!this.worker) return;
    const normalized = Array.from(new Set(
      destinationHashes.map(normalizeDestinationHash).filter((value): value is string => Boolean(value)),
    ));
    if (normalized.length) this.post({ type: 'queryDestinationPaths', destinationHashes: normalized });
  }

  private setLxmfIgnoredDestinations(destinationHashes: string[]): Promise<boolean> {
    if (!this.worker || !get(activeIdentity)) return Promise.resolve(false);
    const requestId = crypto.randomUUID();
    this.post({ type: 'setLxmfIgnoredDestinations', requestId, destinationHashes });
    return new Promise((resolve) => {
      const timeout = window.setTimeout(() => {
        this.ignoredDestinationsWaiters.delete(requestId);
        resolve(false);
      }, 10_000);
      this.ignoredDestinationsWaiters.set(requestId, (ok) => {
        window.clearTimeout(timeout);
        resolve(ok);
      });
    });
  }

  private syncChatContactDestinationsToWorker(): void {
    if (!this.worker) return;
    this.post({
      type: 'setChatContactDestinations',
      destinationHashes: get(chatContacts).map((item) => item.destinationHash),
    });
  }

  private failProbeWaiters(code: string): void {
    for (const waiter of this.probeWaiters.values()) {
      waiter.cleanup?.();
      waiter.resolve({
        ok: false,
        destinationHash: waiter.destinationHash,
        fullDestinationName: waiter.fullDestinationName,
        probeSizeBytes: waiter.probeSizeBytes,
        code,
      });
    }
    this.probeWaiters.clear();
  }
}


export const reticulumRuntime = new ReticulumRuntimeController();
