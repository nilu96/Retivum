import { get, writable } from 'svelte/store';
import type {
  ChatAnnounce,
  ChatBlockedDestination,
  ChatContact,
  ChatAttachment,
  ChatInboundTransfer,
  ChatMessage,
} from '../../domain/chat';
import { normalizeChatAttachments } from '../../domain/chat-attachments';
import {
  chatDeliveryRepresentation,
  chatMessageDisplayStatus,
  chatMessagePeerHash,
  chatMessageProgressStatus,
  chatMessageStatusForState,
  isUnconfirmedPacket,
  shouldUsePropagationFallback,
  upsertChatAnnounce,
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
import type { ReticulumLogEntry } from '../../domain/logging';
import type {
  NomadAnnounce,
  NomadBookmark,
  NomadPage,
  NomadPageLoadUpdate,
  NomadRequestData,
} from '../../domain/nomadnet';
import type { ProvisioningNode } from '../../domain/provisioning';
import { formatNomadAddress, nomadRequestPath, parseNomadAddress, upsertNomadAnnounce } from '../../domain/nomadnet';
import { normalizeDestinationHash, type AppPreferences, type InterfaceConfig } from '../../domain/settings';
import { t } from '../../i18n';
import { BrowserIdentityRepository } from '../database/identity-repository';
import { BrowserChatRepository } from '../database/chat-repository';
import { BrowserNomadRepository } from '../database/nomad-repository';
import { BrowserSettingsRepository } from '../database/settings-repository';
import { BrowserNetworkStateRepository } from '../database/network-state-repository';
import { BrowserProvisioningRepository } from '../database/provisioning-repository';
import { PlatformInterfaceHost } from '../platform/interface-host';
import type {
  ChatMessageQueueResult,
  DestinationPathStatus,
  InterfaceRuntimeState,
  AnnouncedPropagationNode,
  LxmfPropagationSyncResult,
  RuntimeCommand,
  RuntimeConfiguration,
  RuntimeEvent,
  RuntimeState,
  ProvisioningRequestStage,
} from './protocol';
import {
  chatAnnounces,
  blockedChatDestinations,
  chatContacts,
  chatMessages,
  markChatMessagesRead,
  noteUnreadChatMessage,
  unreadChatMessageCount,
} from './chat-state';

export {
  blockedChatDestinations,
  chatAnnounces,
  chatContacts,
  chatMessages,
  unreadChatMessageCount,
} from './chat-state';

export const runtimeStatus = writable<RuntimeState>('starting');
export const chatInboundTransfers = writable<ChatInboundTransfer[]>([]);
export const interfaceStatuses = writable<Record<string, InterfaceRuntimeState>>({});
export const activeIdentity = writable<IdentitySummary | undefined>();
export const identities = writable<IdentitySummary[]>([]);
export const deliveryDestinationHash = writable<string | undefined>();
export const runtimeErrorCode = writable<string | undefined>();
export const propagationSyncActive = writable(false);
export const nomadAnnounces = writable<NomadAnnounce[]>([]);
export const nomadBookmarks = writable<NomadBookmark[]>([]);
export const propagationNodeAnnounces = writable<AnnouncedPropagationNode[]>([]);
export const provisioningNodes = writable<ProvisioningNode[]>([]);
export const destinationPathStatuses = writable<Record<string, DestinationPathStatus>>({});
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
  private readonly platformInterfaceHost = new PlatformInterfaceHost(
    (command) => this.post(command),
    (code, details) => appendLocalLog('debug', 'runtime', code, details),
  );
  private loadedNomadIdentityId?: string;
  private loadedChatIdentityId?: string;
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
  private readonly nomadPageWaiters = new Map<string, {
    resolve: (page: NomadPage | undefined) => void;
    onUpdate?: (update: NomadPageLoadUpdate) => void;
  }>();
  private readonly nomadIdentityWaiters = new Map<string, (ok: boolean) => void>();
  private readonly provisioningWaiters = new Map<string, {
    resolve: (data: Uint8Array) => void;
    reject: (error: ProvisioningRequestFailure) => void;
    onUpdate?: (stage: ProvisioningRequestStage, progress?: number, dataSize?: number) => void;
  }>();
  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    runtimeStatus.set('starting');

    try {
      const [wrappingKey, identity, storedIdentities, settings, networkState, storedProvisioningNodes] = await Promise.all([
        this.identityRepository.getOrCreateWrappingKey(),
        this.identityRepository.loadActiveIdentity(),
        this.identityRepository.loadAll(),
        this.settingsRepository.load(),
        this.networkStateRepository.load(),
        this.provisioningRepository.loadNodes(),
      ]);
      identities.set(storedIdentities.map(identitySummary));
      propagationNodeAnnounces.set([]);
      provisioningNodes.set(storedProvisioningNodes);
      const worker = new Worker(new URL('../../workers/reticulum.worker.ts', import.meta.url), { type: 'module' });
      this.worker = worker;
      worker.onmessage = (message: MessageEvent<RuntimeEvent>) => void this.handleEvent(message.data);
      worker.onerror = () => {
        runtimeErrorCode.set('RUNTIME_WORKER_FAILED');
        runtimeStatus.set('error');
        propagationSyncActive.set(false);
        for (const resolve of this.propagationSyncWaiters.values()) resolve(undefined);
        this.propagationSyncWaiters.clear();
        for (const resolve of this.lxmaPeerWaiters.values()) resolve(undefined);
        this.lxmaPeerWaiters.clear();
        for (const waiter of this.provisioningWaiters.values()) waiter.reject(new ProvisioningRequestFailure('PROVISIONING_RUNTIME_FAILED'));
        this.provisioningWaiters.clear();
      };

      let blockedDestinationHashes: string[] = [];
      let contactDestinationHashes: string[] = [];
      if (identity) {
        const [, chatDirectory] = await Promise.all([
          this.loadNomadDirectory(identity.id),
          this.chatRepository.load(identity.id),
        ]);
        blockedDestinationHashes = chatDirectory.blockedDestinations.map((item) => item.destinationHash);
        contactDestinationHashes = chatDirectory.contacts.map((item) => item.destinationHash);
      }

      const defaultDisplayName = get(t)('settings.identity.defaultDisplayName');

      this.post({
        type: 'initialize',
        wrappingKey,
        identity,
        networkState,
        blockedDestinationHashes,
        contactDestinationHashes,
        newIdentity: {
          id: crypto.randomUUID(),
          label: defaultDisplayName,
          displayName: defaultDisplayName,
        },
        configuration: { preferences: settings.preferences, interfaces: settings.interfaces },
      });
    } catch {
      runtimeErrorCode.set('RUNTIME_INITIALIZATION_FAILED');
      runtimeStatus.set('error');
    }
  }

  async applyConfiguration(preferences: AppPreferences, interfaces: InterfaceConfig[]): Promise<void> {
    const configuration: RuntimeConfiguration = {
      preferences: structuredClone(preferences),
      interfaces: structuredClone(interfaces),
    };
    this.post({ type: 'applyConfiguration', configuration });
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
      if (message.direction === 'outgoing' && (displayStatus === 'queued' || displayStatus === 'sending')) {
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
      || (displayStatus !== 'queued' && displayStatus !== 'sending')) return false;

    try {
      if (!await this.cancelChatMessageDelivery(message.messageId)) return false;

      // The worker normally emits `cancelled` before acknowledging the
      // operation. Keep this fallback for a terminal-state race where the
      // router no longer has the message but the persisted UI record is still
      // pending.
      const current = get(chatMessages).find((item) => item.id === message.id);
      const currentStatus = current ? chatMessageDisplayStatus(current) : undefined;
      if (current && (currentStatus === 'queued' || currentStatus === 'sending')) {
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
        return message.direction === 'outgoing' && (status === 'queued' || status === 'sending');
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
          && (status === 'queued' || status === 'sending');
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

  async addNomadBookmark(address: string, label?: string, identifyBeforeLoad = false): Promise<boolean> {
    const parsed = parseNomadAddress(address);
    const identity = get(activeIdentity);
    if (!parsed || !identity) return false;

    const bookmark: NomadBookmark = {
      id: `${identity.id}:${formatNomadAddress(parsed.destinationHash, parsed.path, parsed.requestData)}`,
      identityId: identity.id,
      destinationHash: parsed.destinationHash,
      path: parsed.path,
      requestData: { ...parsed.requestData },
      identifyBeforeLoad,
      label: label?.trim() || undefined,
      createdAt: new Date().toISOString(),
    };
    await this.nomadRepository.saveBookmark(bookmark);
    nomadBookmarks.update((items) => [bookmark, ...items.filter((item) => item.id !== bookmark.id)]);
    this.refreshDestinationPaths([bookmark.destinationHash]);
    return true;
  }

  async requestNomadPage(
    destinationHash: string,
    path: string,
    requestData: NomadRequestData = {},
    onUpdate?: (update: NomadPageLoadUpdate) => void,
    freshLink = false,
    identifyBeforeLoad = false,
  ): Promise<NomadPage | undefined> {
    const identity = get(activeIdentity);
    const normalizedDestination = normalizeDestinationHash(destinationHash);
    if (!this.worker || !identity || !normalizedDestination) {
      onUpdate?.({ type: 'failed', code: 'NOMAD_RUNTIME_UNAVAILABLE' });
      return undefined;
    }
    const announce = get(nomadAnnounces).find((item) => (
      item.identityId === identity.id && item.destinationHash === normalizedDestination && item.publicKey
    ));
    if (!announce?.publicKey) {
      appendLocalLog('warning', 'runtime', 'NOMAD_DESTINATION_KEY_UNKNOWN', { destinationHash: normalizedDestination });
      onUpdate?.({ type: 'failed', code: 'NOMAD_DESTINATION_UNKNOWN' });
      return undefined;
    }
    const publicKey = announce.publicKey;
    const requestId = crypto.randomUUID();
    return new Promise((resolve) => {
      this.nomadPageWaiters.set(requestId, { resolve, onUpdate });
      this.post({
        type: 'requestNomadPage',
        requestId,
        destinationHash: normalizedDestination,
        path: nomadRequestPath(path),
        requestData,
        publicKey,
        ...(freshLink ? { freshLink: true } : {}),
        ...(identifyBeforeLoad ? { identifyBeforeLoad: true } : {}),
      });
    });
  }

  cancelNomadPage(destinationHash: string, closeLink = false): void {
    const normalizedDestination = normalizeDestinationHash(destinationHash);
    if (this.worker && normalizedDestination) {
      this.post({ type: 'cancelNomadPage', destinationHash: normalizedDestination, closeLink });
    }
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
    if (!this.worker || !get(activeIdentity) || !destinationHash || !/^[0-9a-f]{128}$/i.test(provisioningNode.publicKey)) {
      throw new ProvisioningRequestFailure('PROVISIONING_DESTINATION_UNKNOWN');
    }
    const requestId = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      this.provisioningWaiters.set(requestId, { resolve, reject, onUpdate });
      this.post({
        type: 'requestProvisioning',
        requestId,
        destinationHash,
        publicKey: provisioningNode.publicKey,
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

  async setProvisioningNodeBookmarked(id: string, bookmarked: boolean): Promise<boolean> {
    const updated = await this.provisioningRepository.setNodeBookmarked(id, bookmarked);
    if (!updated) return false;
    provisioningNodes.update((items) => items.map((item) => item.id === id ? updated : item));
    return true;
  }

  async deleteNomadBookmark(id: string): Promise<void> {
    await this.nomadRepository.deleteBookmark(id);
    nomadBookmarks.update((items) => items.filter((item) => item.id !== id));
  }

  async updateNomadBookmark(id: string, name: string, identifyBeforeLoad: boolean): Promise<boolean> {
    const identity = get(activeIdentity);
    const existing = get(nomadBookmarks).find((item) => item.id === id && item.identityId === identity?.id);
    if (!existing) return false;
    const updated: NomadBookmark = {
      ...existing,
      requestData: { ...(existing.requestData ?? {}) },
      identifyBeforeLoad,
      label: name.trim() || undefined,
    };
    await this.nomadRepository.saveBookmark(updated);
    nomadBookmarks.update((items) => items.map((item) => item.id === id ? updated : item));
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

  async importIdentity(backup: ParsedIdentityBackup): Promise<boolean> {
    if (!this.worker) return false;
    const requestId = crypto.randomUUID();
    const displayName = backup.displayName || get(t)('settings.identity.importedDisplayName');
    const privateKey = Uint8Array.from(backup.privateKey);
    const operation = this.waitForIdentityOperation(requestId, {
      type: 'importIdentity',
      requestId,
      metadata: { id: crypto.randomUUID(), label: displayName, displayName },
      privateKey,
      expectedIdentityHash: backup.expectedIdentityHash,
    });
    backup.privateKey.fill(0);
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
    const directory = await this.chatRepository.load(identityId);
    const requestId = crypto.randomUUID();
    return this.waitForIdentityOperation(requestId, {
      type: 'activateIdentity',
      requestId,
      identity: record,
      blockedDestinationHashes: directory.blockedDestinations.map((item) => item.destinationHash),
      contactDestinationHashes: directory.contacts.map((item) => item.destinationHash),
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
    if (!this.worker) return;
    this.post({ type: 'shutdown' });
    void this.platformInterfaceHost.closeAll();
    this.worker = undefined;
    this.started = false;
    for (const waiter of this.nomadPageWaiters.values()) waiter.resolve(undefined);
    this.nomadPageWaiters.clear();
    for (const waiter of this.provisioningWaiters.values()) waiter.reject(new ProvisioningRequestFailure('PROVISIONING_RUNTIME_STOPPED'));
    this.provisioningWaiters.clear();
    for (const resolve of this.nomadIdentityWaiters.values()) resolve(false);
    this.nomadIdentityWaiters.clear();
    for (const resolve of this.propagationSyncWaiters.values()) resolve(undefined);
    this.propagationSyncWaiters.clear();
    propagationSyncActive.set(false);
    for (const resolve of this.messageOperationWaiters.values()) resolve(false);
    this.messageOperationWaiters.clear();
    for (const resolve of this.ignoredDestinationsWaiters.values()) resolve(false);
    this.ignoredDestinationsWaiters.clear();
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
      propagationSyncActive.set(event.syncing);
      return;
    }
    if (event.type === 'interfaceStatus') {
      interfaceStatuses.update((statuses) => ({ ...statuses, [event.id]: event.state }));
      // Connection failures belong to the individual interface. Drivers retry
      // automatically, and another configured interface may still be online,
      // so they must not become a global Reticulum runtime error banner.
      return;
    }
    if (event.type === 'identityReady') {
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
    if (event.type === 'propagationNodeAnnounce') {
      propagationNodeAnnounces.update((items) => [
        event,
        ...items.filter((item) => item.destinationHash !== event.destinationHash),
      ].sort((left, right) => Date.parse(right.heardAt) - Date.parse(left.heardAt)));
      return;
    }
    if (event.type === 'propagationNodeSnapshot') {
      propagationNodeAnnounces.set(event.nodes);
      return;
    }
    if (event.type === 'nomadAnnounce') {
      const announce: NomadAnnounce = {
        id: `${event.identityId}:${event.destinationHash}`,
        identityId: event.identityId,
        destinationHash: event.destinationHash,
        displayName: event.displayName,
        publicKey: event.publicKey,
        interfaceId: event.interfaceId,
        hops: event.hops,
        heardAt: event.heardAt,
      };
      try {
        const mergedAnnounces = upsertNomadAnnounce(get(nomadAnnounces), announce);
        const mergedAnnounce = mergedAnnounces.find((item) => item.id === announce.id) ?? announce;
        await this.nomadRepository.saveAnnounce(mergedAnnounce);
        nomadAnnounces.update((items) => upsertNomadAnnounce(items, mergedAnnounce));
      } catch {
        runtimeErrorCode.set('RUNTIME_NOMAD_DIRECTORY_PERSIST_FAILED');
      }
      return;
    }
    if (event.type === 'managementAnnounce') {
      const previousNode = get(provisioningNodes).find((item) => item.id === event.id);
      const managementNode: ProvisioningNode = {
        id: event.id,
        destinationHash: event.destinationHash,
        publicKey: event.publicKey,
        interfaceId: event.interfaceId,
        hops: event.hops,
        heardAt: event.heardAt,
        bookmarked: previousNode?.bookmarked === true,
      };
      try {
        await this.provisioningRepository.saveNode(managementNode);
        provisioningNodes.update((items) => [
          managementNode,
          ...items.filter((item) => item.id !== managementNode.id),
        ].sort((left, right) => right.heardAt.localeCompare(left.heardAt)));
      } catch {
        appendLocalLog('error', 'persistence', 'PROVISIONING_NODE_PERSIST_FAILED', {
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
    if (event.type === 'chatAnnounce') {
      const announce: ChatAnnounce = {
        id: `${event.identityId}:${event.destinationHash}`,
        identityId: event.identityId,
        destinationHash: event.destinationHash,
        identityHash: event.identityHash,
        publicKey: event.publicKey,
        displayName: event.displayName,
        stampCost: event.stampCost,
        compressionSupported: event.compressionSupported,
        interfaceId: event.interfaceId,
        hops: event.hops,
        heardAt: event.heardAt,
      };
      chatAnnounces.update((items) => upsertChatAnnounce(items, announce));
      try {
        await this.chatRepository.saveAnnounce(announce);
        appendLocalLog('debug', 'persistence', 'CHAT_ANNOUNCE_PERSISTED', {
          destinationHash: announce.destinationHash,
        });
      } catch {
        runtimeErrorCode.set('RUNTIME_CHAT_PERSIST_FAILED');
        appendLocalLog('error', 'persistence', 'CHAT_ANNOUNCE_PERSIST_FAILED', {
          destinationHash: announce.destinationHash,
        });
      }
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
        direction: 'incoming',
        status: 'delivered',
        timestamp: event.timestamp,
        receivedAt: event.receivedAt,
      };
      const isNewMessage = !get(chatMessages).some((item) => item.id === message.id);
      chatMessages.update((items) => upsertChatMessage(items, message));
      if (isNewMessage) noteUnreadChatMessage(message.sourceHash);
      try {
        await this.chatRepository.saveMessage(message);
        appendLocalLog('debug', 'persistence', 'CHAT_MESSAGE_PERSISTED', { messageId: message.messageId });
      } catch {
        runtimeErrorCode.set('RUNTIME_CHAT_PERSIST_FAILED');
        appendLocalLog('error', 'persistence', 'CHAT_MESSAGE_PERSIST_FAILED', { messageId: message.messageId });
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
        direction: 'outgoing',
        status: 'queued',
        propagationFallbackPending: event.propagationFallbackPending,
        timestamp: event.timestamp,
        receivedAt: event.queuedAt,
      };
      chatMessages.update((items) => upsertChatMessage(
        previousId && previousId !== message.id ? items.filter((item) => item.id !== previousId) : items,
        message,
      ));
      try {
        if (previousId) await this.chatRepository.replaceMessage(previousId, message);
        else await this.chatRepository.saveMessage(message);
        appendLocalLog('debug', 'persistence', event.replacesMessageId
          ? 'CHAT_OUTBOUND_PROPAGATION_FALLBACK_PERSISTED'
          : 'CHAT_OUTBOUND_PERSISTED', { messageId: message.messageId });
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
        ? { received: event.received ?? 0, duplicates: event.duplicates ?? 0 }
        : undefined;
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
    if (event.type === 'persistIdentity') {
      let ok = false;
      try {
        if (event.activate) await this.identityRepository.saveAndActivate(event.identity);
        else await this.identityRepository.save(event.identity);
        this.upsertIdentitySummary(event.identity);
        if (event.activate || get(activeIdentity)?.id === event.identity.id) {
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
    if (this.loadedNomadIdentityId === identityId) return;
    const directory = await this.nomadRepository.load(identityId);
    this.loadedNomadIdentityId = identityId;
    nomadAnnounces.set(directory.announces);
    nomadBookmarks.set(directory.bookmarks);
  }

  private async loadChatDirectory(identityId: string): Promise<void> {
    if (this.loadedChatIdentityId === identityId) return;
    const directory = await this.chatRepository.load(identityId);
    if (get(activeIdentity)?.id !== identityId) return;
    if (this.loadedChatIdentityId && this.loadedChatIdentityId !== identityId) markChatMessagesRead();
    this.loadedChatIdentityId = identityId;
    chatAnnounces.update((liveItems) => liveItems
      .filter((item) => item.identityId === identityId)
      .reduce((items, item) => upsertChatAnnounce(items, item), directory.announces));
    chatContacts.update((liveItems) => liveItems
      .filter((item) => item.identityId === identityId)
      .reduce((items, item) => upsertChatContact(items, item), directory.contacts));
    chatMessages.update((liveItems) => liveItems
      .filter((item) => item.identityId === identityId)
      .reduce((items, item) => upsertChatMessage(items, item), directory.messages));
    blockedChatDestinations.set(directory.blockedDestinations);
  }

  private refreshKnownDestinationPaths(): void {
    this.refreshDestinationPaths([
      ...get(nomadAnnounces).map((item) => item.destinationHash),
      ...get(nomadBookmarks).map((item) => item.destinationHash),
      ...get(chatAnnounces).map((item) => item.destinationHash),
      ...get(chatContacts).map((item) => item.destinationHash),
      ...get(chatMessages).map(chatMessagePeerHash),
      ...get(blockedChatDestinations).map((item) => item.destinationHash),
      ...get(provisioningNodes).map((item) => item.destinationHash),
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
}


export const reticulumRuntime = new ReticulumRuntimeController();
