/// <reference lib="webworker" />

import initWasm, {
  ReticulumNode,
} from '../../leviculum_wasm/leviculum_wasm.js';
import type { EncryptedPayload, PersistedIdentityRecord } from '../domain/identity';
import { bytesToHex, identityAnnounceIsDue, identityLastAnnouncedAtMs } from '../domain/identity';
import type { PersistedNetworkStateRecord } from '../domain/network-state';
import {
  imageMime,
  inferAttachmentMimeType,
  normalizeChatAttachments,
  safeAttachmentName,
} from '../domain/chat-attachments';
import type {
  ChatAttachment,
  ChatMessageStamp,
  ChatMessagePathSnapshot,
} from '../domain/chat';
import {
  inboundChatMessageStamp,
  outboundChatMessageStamp,
} from '../domain/chat-stamps';
import type { ReticulumLogEntry, ReticulumLogLevel } from '../domain/logging';
import { parseLxmaAddress } from '../domain/lxmf';
import {
  announcePacketDestinationHash,
  createInterfaceAnnounceHistoryRecord,
  hasCurrentInterfaceAnnounce,
  interfaceAnnounceHistoryId,
  interfaceNetworkFingerprint,
  latestDestinationAnnouncedAt,
  lxmfDeliveryAnnounceFingerprint,
  normalizeInterfaceAnnounceHistoryRecord,
  shouldSuppressInterfaceOnlineAnnounce,
  type InterfaceAnnounceHistoryRecord,
} from '../domain/interface-announce';
import { normalizeInDestinationHashes } from '../infrastructure/reticulum/in-destination-hashes';
import { lxmfAttachmentInput } from '../infrastructure/reticulum/lxmf-attachments';
import {
  decodeNomadNodeAppData,
  encodeNomadRequestData,
  nomadPageLoadDeadlineMs,
  nomadRequestPath,
  unpackNomadPageResponse,
  type NomadPageLoadStage,
  type NomadRequestData,
} from '../domain/nomadnet';
import {
  lxmfInboundSourceAllowed,
  normalizeDestinationHash,
  propagationIsActive,
  resolveLxmfDeliveryPlan,
  type InterfaceConfig,
  type WebSocketInterfaceConfig,
} from '../domain/settings';
import type {
  InterfaceRuntimeState,
  LxmfPropagationSyncState,
  RuntimeCommand,
  RuntimeConfiguration,
  RuntimeEvent,
  RuntimeState,
} from '../infrastructure/reticulum/protocol';
import { maximumProbePayloadBytes } from '../infrastructure/reticulum/protocol';
import { diagnosticErrorMessage } from '../infrastructure/reticulum/diagnostic-error';
import { leviculumInterfaceMode } from '../infrastructure/reticulum/interface-mode';
import { resolvePathRoute, resolveProbeRoute } from '../infrastructure/reticulum/path-route';
import {
  planRuntimeInterfaceTransition,
  remapPersistentPaths,
  type RuntimeInterfaceBinding,
} from '../infrastructure/reticulum/path-interface-transition';
import { classifyInboundResourceEvent } from '../infrastructure/reticulum/resource-transfer-events';
import { requiresReticulumRuntimeRebuild } from '../infrastructure/reticulum/runtime-configuration';
import { StampWorkRegistry } from '../infrastructure/reticulum/stamp-work';
import { computeRNodeBitrate, InterfaceTelemetryTracker } from '../infrastructure/reticulum/interface-telemetry';
import { pathRequestTimeoutMs } from '../infrastructure/reticulum/timeouts';

interface GeneratedIdentity {
  hash: Uint8Array;
  publicKey: Uint8Array;
  privateKey: Uint8Array;
}

interface WasmOutput {
  actions?: WasmAction[];
  events?: Array<Record<string, unknown>>;
  dirtyPersistentState?: boolean;
}

interface WasmAction {
  type: 'send' | 'broadcast' | string;
  iface?: number;
  excludeIface?: number;
  excludeIfaces?: number[];
  data: Uint8Array | number[];
  packet: {
    packetType?: 'data' | 'announce' | 'linkRequest' | 'proof';
    destinationHash?: Uint8Array | number[];
    context?: number;
    highPriority: boolean;
  };
}

const scope = self as DedicatedWorkerGlobalScope;
const idleDeadlineCheckMs = 1_000;
const maxTimerDelayMs = 2_147_483_647;
const maxTextFrameBytes = 2 * 1024 * 1024;
const reconnectInitialDelayMs = 1_500;
const reconnectMaximumDelayMs = 30_000;
const reconnectMultiplier = 2;
const reconnectJitter = 0.2;
const maxNomadPageBytes = 1024 * 1024;
const maxProvisioningResponseBytes = 4 * 1024 * 1024;
const provisioningRequestDeadlineMs = 120_000;
const maxNomadLinkRecoveryAttempts = 1;
const maxCachedNomadLinks = 32;
const maxPendingInboundResourceAdvertisements = 64;
const nomadLinkIdleTtlMs = 30 * 60 * 1_000;
const automaticAnnounceRetryDelayMs = 30_000;

interface NomadPageJob {
  requestId: string;
  destinationHash: string;
  path: string;
  requestData: NomadRequestData;
  publicKey?: string;
  identifyBeforeRequest: boolean;
  recoveryAttempts: number;
  startedAt: number;
  linkId?: string;
  timer?: ReturnType<typeof setTimeout>;
  deadlineAt?: number;
  deadlineTimer?: ReturnType<typeof setTimeout>;
}

interface NomadLinkState {
  destinationHash: string;
  linkId: Uint8Array;
  established: boolean;
  everEstablished: boolean;
  identified: boolean;
  lastUsedAt: number;
}

interface NomadLinkEstablishmentJob {
  requestId: string;
  destinationHash: string;
  publicKey?: string;
  startedAt: number;
  pathTimer?: ReturnType<typeof setTimeout>;
  deadlineTimer?: ReturnType<typeof setTimeout>;
  deadlineAt?: number;
}

interface ProvisioningJob {
  requestId: string;
  destinationHash: string;
  publicKey?: string;
  payload: Uint8Array;
  safeToRetry: boolean;
  responseTimeoutMs?: number;
  recoveryAttempts: number;
  linkId?: string;
  pathTimer?: ReturnType<typeof setTimeout>;
  deadlineTimer?: ReturnType<typeof setTimeout>;
}

interface ProvisioningLinkState {
  destinationHash: string;
  linkId: Uint8Array;
  established: boolean;
  everEstablished: boolean;
  identified: boolean;
}

interface ProbeJob {
  requestId: string;
  sourceDestinationHash: string;
  destinationHash: string;
  fullDestinationName: string;
  timeoutMs: number;
  probeSizeBytes: number;
  phase: 'findingPath' | 'awaitingProof';
  packetHash?: string;
  sentAtMs?: number;
  publicKey?: Uint8Array;
  viaHash?: string;
  interfaceName?: string;
  interfaceType?: InterfaceConfig['type'];
  timer?: ReturnType<typeof setTimeout>;
}

interface DestinationPathRequestJob {
  requestId: string;
  destinationHash: string;
  timer: ReturnType<typeof setTimeout>;
}

let node: ReticulumNode | undefined;
let wrappingKey: CryptoKey | undefined;
let privateKey: Uint8Array | undefined;
let identity: PersistedIdentityRecord | undefined;
let persistedNetworkState: PersistedNetworkStateRecord | undefined;
let configuration: RuntimeConfiguration | undefined;
let blockedDestinationHashes: string[] = [];
let localLxmfDeliveryDestinationHash: string | undefined;
let interfaceAnnounceHistory = new Map<string, InterfaceAnnounceHistoryRecord>();
let contactDestinationHashes = new Set<string>();
let nomadNodeNameHash: Uint8Array | undefined;
let managementNodeNameHash: Uint8Array | undefined;
let tickTimer: ReturnType<typeof setTimeout> | undefined;
let autoAnnounceTimer: ReturnType<typeof setTimeout> | undefined;
let automaticPropagationSyncTimer: ReturnType<typeof setTimeout> | undefined;
let statusDetailsTimer: ReturnType<typeof setInterval> | undefined;
let automaticPropagationSyncPending = false;
let propagationSyncRequestId: string | undefined;
let propagationSyncStatusSignature = '';
let persistenceQueue = Promise.resolve();
const stampWork = new StampWorkRegistry();
const persistenceWaiters = new Map<string, (ok: boolean) => void>();
const networkPersistenceWaiters = new Map<string, (ok: boolean) => void>();
const activationStorageWaiters = new Map<string, (ok: boolean) => void>();
interface InterfaceDriver {
  state: InterfaceRuntimeState;
  readonly stableId: string;
  readonly networkFingerprint: string;
  readonly reannounceOnReconnect: boolean;
  readonly telemetry: InterfaceTelemetryTracker;
  runtimeIndex(): number | undefined;
  hasRuntimeId(runtimeId: number | undefined): boolean;
  attach(owner: ReticulumNode): void;
  connect(): void;
  disconnect(notifyNode?: boolean): void;
  dispatch(action: WasmAction): boolean;
}

const drivers = new Map<string, InterfaceDriver>();
const activeLinkIds = new Set<string>();
const nomadPendingJobs = new Map<string, NomadPageJob[]>();
const nomadRequests = new Map<string, NomadPageJob>();
const nomadLinkEstablishmentJobs = new Map<string, NomadLinkEstablishmentJob[]>();
const nomadLinksByDestination = new Map<string, NomadLinkState>();
const nomadLinksById = new Map<string, NomadLinkState>();
const provisioningPendingJobs = new Map<string, ProvisioningJob[]>();
const provisioningRequests = new Map<string, ProvisioningJob>();
const provisioningLinksByDestination = new Map<string, ProvisioningLinkState>();
const provisioningLinksById = new Map<string, ProvisioningLinkState>();
const probeJobs = new Map<string, ProbeJob>();
const probeJobsByPacketHash = new Map<string, ProbeJob>();
const destinationPathRequestJobs = new Map<string, DestinationPathRequestJob>();
const knownDestinationPublicKeys = new Map<string, Uint8Array>();
const registeredFullDestinationNames = [
  'lxmf.delivery',
  'lxmf.propagation',
  'nomadnetwork.node',
  'rnstransport.probe',
  'rnstransport.remote.management',
] as const;
type RegisteredFullDestinationName = typeof registeredFullDestinationNames[number];
const lxmfPropagationSyncStates = new Set<LxmfPropagationSyncState>([
  'idle',
  'pathRequested',
  'linkEstablishing',
  'linkEstablished',
  'requestSent',
  'receiving',
  'responseReceived',
  'complete',
  'noPath',
  'linkFailed',
  'transferFailed',
  'noIdentity',
  'noAccess',
  'failed',
]);
const knownDestinationFullNames = new Map<string, RegisteredFullDestinationName | null>();
let pathManagementSnapshotSignature = '';
const lxmfOutboundStatusCache = new Map<string, string>();
const lxmfDeliveryLinks = new Set<string>();
const lxmfLinkDestinations = new Map<string, string>();
const inboundChatTransfers = new Map<string, {
  linkId: string;
  destinationHash?: string;
  dataSize: number;
  transferSize?: number;
  segmentIndex: number;
  totalSegments: number;
}>();
const inboundResourceSegments = new Map<string, {
  transferId: string;
  segmentIndex: number;
  totalSegments: number;
}>();
const pendingInboundResourceAdvertisements = new Map<string, {
  linkId: string;
  transferId: string;
  segmentIndex: number;
  totalSegments: number;
  dataSize: number;
  transferSize?: number;
}>();
const observedDestinationPaths = new Set<string>();
const destinationPathStatusCache = new Map<string, string>();
// Leviculum Core emits fresh destination announces whenever an interface is
// marked online. Retivum suppresses every announce in that interface-up output
// and, when the persisted first/reconnect policy requires it, sends one
// metadata-complete LXMF delivery announce targeted to the interface. Other
// actions and all events remain untouched.

function emit(event: RuntimeEvent): void {
  if (event.type === 'platformInterfaceWrite') {
    scope.postMessage(event, [event.data.buffer as ArrayBuffer]);
    return;
  }
  scope.postMessage(event);
}

function log(
  level: ReticulumLogLevel,
  source: ReticulumLogEntry['source'],
  code: string,
  details?: ReticulumLogEntry['details'],
): void {
  emit({
    type: 'runtimeLog',
    entry: { id: crypto.randomUUID(), timestamp: new Date().toISOString(), level, source, code, details },
  });
}

scope.onmessage = (message: MessageEvent<RuntimeCommand>) => {
  void handleCommand(message.data);
};

async function handleCommand(command: RuntimeCommand): Promise<void> {
  try {
    if (command.type === 'initialize') {
      log('info', 'runtime', 'RUNTIME_INITIALIZING');
      wrappingKey = command.wrappingKey;
      persistedNetworkState = command.networkState;
      configuration = command.configuration;
      blockedDestinationHashes = command.blockedDestinationHashes;
      contactDestinationHashes = normalizeDestinationHashes(command.contactDestinationHashes);
      interfaceAnnounceHistory = normalizedInterfaceAnnounceHistory(command.interfaceAnnounceHistory);
      pruneInterfaceAnnounceHistory(command.configuration.interfaces);
      emit({ type: 'runtimeStatus', state: 'starting' });
      await initWasm();
      nomadNodeNameHash = ReticulumNode.fullHash(new TextEncoder().encode('nomadnetwork.node')).slice(0, 10);
      managementNodeNameHash = ReticulumNode.fullHash(new TextEncoder().encode('rnstransport.remote.management')).slice(0, 10);

      if (command.identity) {
        identity = command.identity;
        privateKey = await decrypt(command.identity.encryptedPrivateKey);
        log('info', 'persistence', 'IDENTITY_RESTORED');
      } else {
        const generated = ReticulumNode.generateIdentity() as GeneratedIdentity;
        privateKey = new Uint8Array(generated.privateKey);
        const now = new Date().toISOString();
        identity = {
          id: command.newIdentity.id,
          schemaVersion: 1,
          label: command.newIdentity.label,
          displayName: command.newIdentity.displayName,
          identityHash: new Uint8Array(generated.hash),
          publicKey: new Uint8Array(generated.publicKey),
          encryptedPrivateKey: await encrypt(privateKey),
          createdAt: now,
          updatedAt: now,
        };
        await requestIdentitySave(identity, true);
        log('info', 'persistence', 'IDENTITY_GENERATED');
      }

      await rebuildRuntime(false, command.startupId);
      return;
    }

    if (command.type === 'applyConfiguration') {
      log('info', 'runtime', 'CONFIGURATION_APPLYING', { interfaces: command.configuration.interfaces.length });
      const rebuild = requiresReticulumRuntimeRebuild(configuration, command.configuration);
      const interfacesChanged = JSON.stringify(configuration?.interfaces ?? [])
        !== JSON.stringify(command.configuration.interfaces);
      const previousBindings = interfacesChanged
        ? runtimeInterfaceBindings()
        : undefined;
      configuration = command.configuration;
      pruneInterfaceAnnounceHistory(command.configuration.interfaces);
      if (identity && privateKey) {
        if (rebuild) {
          await rebuildRuntime(
            true,
            undefined,
            previousBindings
              ? {
                  previousBindings,
                  nextInterfaces: command.configuration.interfaces,
                }
              : undefined,
          );
        } else {
          automaticPropagationSyncPending = false;
          scheduleAutomaticAnnounce();
          scheduleAutomaticPropagationSync();
          log('info', 'runtime', 'CONFIGURATION_APPLIED_LIVE');
        }
      }
      return;
    }

    if (command.type === 'announceLxmf') {
      emit({ type: 'lxmfAnnounceResult', requestId: command.requestId, ok: announceLxmf('manual') });
      return;
    }

    if (command.type === 'syncLxmfPropagation') {
      syncLxmfPropagation(command.requestId);
      return;
    }

    if (command.type === 'sendLxmfMessage') {
      sendLxmfMessage(command);
      return;
    }

    if (command.type === 'importLxmaPeer') {
      importLxmaPeer(command);
      return;
    }

    if (command.type === 'cancelLxmfMessage') {
      cancelLxmfMessage(command);
      return;
    }

    if (command.type === 'setLxmfIgnoredDestinations') {
      const previous = blockedDestinationHashes;
      try {
        blockedDestinationHashes = normalizeBlockedDestinationHashes(command.destinationHashes);
        applyBlockedDestinationPolicy();
        emit({ type: 'lxmfIgnoredDestinationsResult', requestId: command.requestId, ok: true });
      } catch (error) {
        blockedDestinationHashes = previous;
        const code = errorCode(error);
        log('error', 'wasm', 'LXMF_IGNORED_DESTINATIONS_UPDATE_FAILED', { code });
        emit({ type: 'lxmfIgnoredDestinationsResult', requestId: command.requestId, ok: false, code });
      }
      return;
    }

    if (command.type === 'setChatContactDestinations') {
      contactDestinationHashes = normalizeDestinationHashes(command.destinationHashes);
      log('debug', 'runtime', 'CHAT_CONTACT_POLICY_APPLIED', { count: contactDestinationHashes.size });
      return;
    }

    if (command.type === 'requestNomadPage') {
      requestNomadPage(command);
      return;
    }
    if (command.type === 'establishNomadLink') {
      establishNomadLink(command);
      return;
    }
    if (command.type === 'identifyNomadLink') {
      identifyNomadLink(command);
      return;
    }

    if (command.type === 'cancelNomadPage') {
      cancelNomadPage(command.destinationHash, command.closeLink ?? false);
      return;
    }

    if (command.type === 'requestProvisioning') {
      requestProvisioning(command);
      return;
    }

    if (command.type === 'cancelProvisioning') {
      cancelProvisioning(command.destinationHash, command.closeLink ?? false);
      return;
    }

    if (command.type === 'closeProvisioning') {
      closeProvisioning();
      return;
    }

    if (command.type === 'queryDestinationPaths') {
      emitDestinationPathStatuses(command.destinationHashes);
      return;
    }

    if (command.type === 'requestDestinationPath') {
      requestDestinationPath(command);
      return;
    }

    if (command.type === 'cancelDestinationPathRequest') {
      finishDestinationPathRequest(command.requestId, false, undefined, 'PATH_REQUEST_CANCELLED');
      return;
    }

    if (command.type === 'dropDestinationPath') {
      dropDestinationPath(command);
      return;
    }

    if (command.type === 'clearDestinationPaths') {
      clearDestinationPaths(command.requestId);
      return;
    }

    if (command.type === 'forgetKnownDestination') {
      await forgetKnownDestinations(command.requestId, [command.destinationHash]);
      return;
    }

    if (command.type === 'clearKnownDestinations') {
      await forgetKnownDestinations(command.requestId);
      return;
    }

    if (command.type === 'probeDestination') {
      probeDestination(command);
      return;
    }

    if (command.type === 'cancelProbe') {
      cancelProbe(command.requestId);
      return;
    }

    if (command.type === 'closeAllLinks') {
      closeAllActiveLinks();
      return;
    }


    if (command.type === 'updateIdentityDisplayName') {
      const displayName = command.displayName.trim();
      if (!identity || !displayName) {
        emit({ type: 'identityDisplayNameResult', requestId: command.requestId, ok: false });
        return;
      }
      const update = persistenceQueue.then(() => persistIdentityDisplayName(displayName));
      persistenceQueue = update.then(() => undefined, () => undefined);
      const ok = await update.catch(() => false);
      emit({ type: 'identityDisplayNameResult', requestId: command.requestId, ok });
      return;
    }

    if (command.type === 'createIdentity') {
      const generated = ReticulumNode.generateIdentity() as GeneratedIdentity;
      const created = await persistedIdentityFromGenerated(generated, command.metadata);
      emit({ type: 'identityCreated', requestId: command.requestId, identity: created });
      return;
    }

    if (command.type === 'importIdentity') {
      const imported = ReticulumNode.identityFromPrivateKey(command.privateKey) as GeneratedIdentity;
      if (command.expectedIdentityHash
        && bytesToHex(new Uint8Array(imported.hash)) !== command.expectedIdentityHash.toLowerCase()) {
        emit({ type: 'identityOperationResult', requestId: command.requestId, ok: false });
        return;
      }
      const created = await persistedIdentityFromGenerated(imported, command.metadata);
      emit({ type: 'identityCreated', requestId: command.requestId, identity: created });
      return;
    }

    if (command.type === 'exportIdentity') {
      const exportedPrivateKey = await decrypt(command.identity.encryptedPrivateKey);
      const derived = ReticulumNode.identityFromPrivateKey(exportedPrivateKey) as GeneratedIdentity;
      if (bytesToHex(new Uint8Array(derived.hash)) !== bytesToHex(command.identity.identityHash)) {
        emit({ type: 'identityOperationResult', requestId: command.requestId, ok: false });
        return;
      }
      emit({
        type: 'identityExported',
        requestId: command.requestId,
        identityId: command.identity.id,
        privateKey: exportedPrivateKey,
      });
      exportedPrivateKey.fill(0);
      return;
    }

    if (command.type === 'activateIdentity') {
      const activation = persistenceQueue.then(() => activateIdentityRecord(
        command.identity,
        command.blockedDestinationHashes,
        command.contactDestinationHashes,
        command.interfaceAnnounceHistory,
      ));
      persistenceQueue = activation.then(() => undefined, () => undefined);
      const ok = await activation.catch(() => false);
      emit({ type: 'identityOperationResult', requestId: command.requestId, ok });
      return;
    }

    if (command.type === 'activationStorageResult') {
      activationStorageWaiters.get(command.requestId)?.(command.ok);
      activationStorageWaiters.delete(command.requestId);
      return;
    }

    if (command.type === 'persistenceResult') {
      persistenceWaiters.get(command.requestId)?.(command.ok);
      persistenceWaiters.delete(command.requestId);
      return;
    }

    if (command.type === 'networkPersistenceResult') {
      networkPersistenceWaiters.get(command.requestId)?.(command.ok);
      networkPersistenceWaiters.delete(command.requestId);
      return;
    }

    if (command.type === 'platformInterfaceState') {
      const driver = drivers.get(command.id);
      if (driver instanceof PlatformInterfaceDriver) driver.handlePlatformState(command.state, command.errorCode);
      return;
    }

    if (command.type === 'platformInterfaceData') {
      const driver = drivers.get(command.id);
      if (driver instanceof PlatformInterfaceDriver) driver.receive(command.data);
      return;
    }

    if (command.type === 'platformInterfaceTelemetry') {
      const driver = drivers.get(command.id);
      if (driver instanceof PlatformInterfaceDriver) {
        driver.telemetry.updateRNode(command.telemetry);
        emitStatusDetails();
      }
      return;
    }

    if (command.type === 'shutdown') {
      log('info', 'runtime', 'RUNTIME_SHUTTING_DOWN');
      await persistSnapshot();
      cleanupRuntime();
      scope.close();
    }
  } catch (error) {
    const code = errorCode(error);
    log('error', 'runtime', code);
    emit({ type: 'runtimeError', code });
    emit({ type: 'runtimeStatus', state: 'error' });
  }
}

interface PathInterfaceTransition {
  previousBindings: RuntimeInterfaceBinding[];
  nextInterfaces: InterfaceConfig[];
}

interface ExportedRuntimePersistentState {
  identity: unknown;
  network: Record<string, unknown>;
  persisted: boolean;
}

async function rebuildRuntime(
  persistCurrent = false,
  startupId?: string,
  pathInterfaceTransition?: PathInterfaceTransition,
): Promise<void> {
  if (!identity || !privateKey || !configuration) return;
  const transitionPlan = pathInterfaceTransition
    ? planRuntimeInterfaceTransition(
        pathInterfaceTransition.previousBindings,
        pathInterfaceTransition.nextInterfaces,
      )
    : undefined;
  if (transitionPlan && node) {
    for (const runtimeIndex of transitionPlan.unavailableRuntimeIndexes) {
      processOutput(node.setInterfaceOnline(runtimeIndex, false) as WasmOutput);
    }
  }
  const livePersistentState = persistCurrent && node
    ? await persistSnapshot(transitionPlan
        ? (networkSnapshot) => {
            const result = remapPersistentPaths(
              networkSnapshot,
              transitionPlan,
            );
            log('info', 'runtime', 'PATHS_RECONCILED_FOR_INTERFACE_CONFIGURATION', {
              unavailableInterfaces: transitionPlan.unavailableRuntimeIndexes.length,
              retained: result.retained,
              discarded: result.discarded,
              remapped: result.remapped,
            });
            return result.snapshot;
          }
        : undefined)
    : undefined;
  cleanupRuntime(new Set(transitionPlan?.unavailableRuntimeIndexes ?? []));

  let legacyPersistentState: unknown;
  let networkPersistentState: unknown = livePersistentState?.network;
  let identityPersistentState: unknown = livePersistentState?.identity;
  const encryptedNetworkSnapshot = persistedNetworkState?.encryptedSnapshot;
  const hasPersistedNetworkSnapshot = encryptedNetworkSnapshot !== undefined;
  let networkInventoryComplete = livePersistentState !== undefined || !hasPersistedNetworkSnapshot;
  if (!livePersistentState) {
    if (encryptedNetworkSnapshot) {
      try {
        networkPersistentState = decodeSnapshot(await decrypt(encryptedNetworkSnapshot));
        networkInventoryComplete = true;
      } catch {
        emit({ type: 'runtimeError', code: 'RUNTIME_NETWORK_SNAPSHOT_RESTORE_FAILED' });
      }
    }
    if (identity.encryptedSnapshot) {
      try {
        const decoded = decodeSnapshot(await decrypt(identity.encryptedSnapshot));
        if (hasPersistedNetworkSnapshot && networkInventoryComplete) identityPersistentState = decoded;
        else legacyPersistentState = decoded;
      } catch {
        if (!hasPersistedNetworkSnapshot) networkInventoryComplete = false;
        emit({ type: 'runtimeError', code: 'RUNTIME_SNAPSHOT_RESTORE_FAILED' });
      }
    }
  }
  restoreKnownDestinationPublicKeys(networkPersistentState ?? legacyPersistentState);

  node = new ReticulumNode({
    identityPrivateKey: privateKey,
    persistentState: legacyPersistentState,
    networkPersistentState,
    identityPersistentState,
    transportEnabled: configuration.preferences.transportEnabled,
  });
  const propagationHash = normalizeDestinationHash(configuration.preferences.lxmf.propagationNodeHash ?? '');
  const lxmf = node.enableLxmf({
    enableRatchets: true,
    enablePropagationClient: true,
    inboundStampCost: configuration.preferences.lxmf.inboundStampCost,
  }) as {
    deliveryDestinationHash?: Uint8Array;
  };
  if (lxmf.deliveryDestinationHash) {
    localLxmfDeliveryDestinationHash = bytesToHex(new Uint8Array(lxmf.deliveryDestinationHash));
  }
  applyBlockedDestinationPolicy();

  if (startupId && networkInventoryComplete) emitCompleteKnownIdentityInventory(startupId);

  for (const interfaceConfig of configuration.interfaces) {
    if (!interfaceConfig.enabled) {
      emit({ type: 'interfaceStatus', id: interfaceConfig.id, state: 'disabled' });
      continue;
    }
    const driver: InterfaceDriver = interfaceConfig.type === 'websocket'
      ? new WebSocketDriver(interfaceConfig)
      : new PlatformInterfaceDriver(interfaceConfig);
    drivers.set(interfaceConfig.id, driver);
    driver.attach(node);
    driver.connect();
  }

  emitPropagationNodeSnapshot();
  emitKnownDestinationSnapshot();

  emit({
    type: 'identityReady',
    identity,
    deliveryDestinationHashHex: localLxmfDeliveryDestinationHash,
  });
  log('info', 'runtime', 'RUNTIME_READY', {
    interfaces: configuration.interfaces.filter((item) => item.enabled).length,
    transport: configuration.preferences.transportEnabled,
    propagationSending: propagationIsActive(configuration.preferences.lxmf),
    propagationConfigured: propagationHash !== undefined,
  });
  emitAggregateStatus();
  emitStatusDetails();
  statusDetailsTimer = setInterval(emitStatusDetails, 1_000);
  scheduleNextTick();
  scheduleAutomaticAnnounce();
  scheduleAutomaticPropagationSync();
  if (livePersistentState && !livePersistentState.persisted) queueSnapshotPersistence();
  if (legacyPersistentState && !persistedNetworkState) queueSnapshotPersistence();
}

function normalizeBlockedDestinationHashes(destinationHashes: string[]): string[] {
  return Array.from(normalizeDestinationHashes(destinationHashes)).sort();
}

function restoreKnownDestinationPublicKeys(state: unknown): void {
  if (!state || typeof state !== 'object') return;
  const source = state as Record<string, unknown>;
  const identities = source.knownIdentities ?? source.known_identities;
  if (!Array.isArray(identities)) return;
  for (const value of identities) {
    if (!value || typeof value !== 'object') continue;
    const entry = value as Record<string, unknown>;
    const destinationHash = eventBytes(entry, 'destinationHash');
    const publicKey = eventBytes(entry, 'publicKey');
    if (destinationHash?.byteLength !== 16 || publicKey?.byteLength !== 64) continue;
    knownDestinationPublicKeys.set(bytesToHex(destinationHash), new Uint8Array(publicKey));
  }
}

function emitCompleteKnownIdentityInventory(startupId: string): void {
  if (!node) return;
  let snapshot: Record<string, unknown>;
  try {
    snapshot = node.exportNetworkPersistentState() as Record<string, unknown>;
  } catch {
    return;
  }
  const identities = snapshot.knownIdentities ?? snapshot.known_identities;
  const destinationHashes = Array.from(new Set(arrayRecords(identities).flatMap((entry) => {
    const destinationHash = eventBytes(entry, 'destinationHash');
    const publicKey = eventBytes(entry, 'publicKey');
    return destinationHash?.byteLength === 16 && publicKey?.byteLength === 64
      ? [bytesToHex(destinationHash)]
      : [];
  }))).sort();
  emit({
    type: 'knownIdentityInventoryReady',
    startupId,
    destinationHashes,
  });
}

function emitKnownDestinationSnapshot(): void {
  let snapshot: Record<string, unknown> | undefined;
  let inDestinationHashes: string[] = [];
  if (node) {
    try {
      snapshot = node.exportNetworkPersistentState() as Record<string, unknown>;
    } catch {
      // The in-memory indexes below still provide a safe partial snapshot.
    }
    try {
      inDestinationHashes = normalizeInDestinationHashes(node.inDestinationHashes());
    } catch {
      // A malformed runtime result must not prevent remote destination updates.
    }
  }
  emitPathManagementSnapshot(snapshot, inDestinationHashes);
}

function emitPathManagementSnapshot(
  snapshot: Record<string, unknown> | undefined,
  inDestinationHashes: string[],
): void {
  const persistentState = snapshot ?? {};
  const lastAnnouncedAtByHash = new Map<string, string>();
  for (const entry of arrayRecords(persistentState.knownDestinations)) {
    const destinationHash = eventBytes(entry, 'destinationHash');
    const lastAnnounceMs = eventNumber(entry, 'lastAnnounceMs');
    if (destinationHash?.byteLength !== 16 || lastAnnounceMs === undefined || lastAnnounceMs <= 0) continue;
    lastAnnouncedAtByHash.set(bytesToHex(destinationHash), new Date(lastAnnounceMs).toISOString());
  }

  const paths = arrayRecords(persistentState.paths).flatMap((entry) => {
    const destinationHash = eventBytes(entry, 'destinationHash');
    const hops = eventNumber(entry, 'hops');
    if (destinationHash?.byteLength !== 16 || hops === undefined) return [];
    const destinationHashHex = bytesToHex(destinationHash);
    const nextHop = eventBytes(entry, 'nextHop');
    const interfaceIndex = eventNumber(entry, 'interfaceIndex');
    const expiresMs = eventNumber(entry, 'expiresMs');
    const interfaceId = stableInterfaceId(interfaceIndex);
    const lastAnnouncedAt = lastAnnouncedAtByHash.get(destinationHashHex);
    return [{
      destinationHash: destinationHashHex,
      hops,
      ...(nextHop?.byteLength === 16 ? { nextHop: bytesToHex(nextHop) } : {}),
      ...(interfaceId ? { interfaceId } : {}),
      ...(expiresMs !== undefined && expiresMs > 0 ? { expiresAt: new Date(expiresMs).toISOString() } : {}),
      ...(lastAnnouncedAt ? { lastAnnouncedAt } : {}),
    }];
  }).sort((left, right) => (
    (right.lastAnnouncedAt ?? '').localeCompare(left.lastAnnouncedAt ?? '')
    || left.destinationHash.localeCompare(right.destinationHash)
  ));

  const knownByHash = new Map<string, {
    destinationHash: string;
    publicKey?: string;
    lastAnnouncedAt?: string;
    fullDestinationName?: RegisteredFullDestinationName;
  }>();
  for (const entry of arrayRecords(persistentState.knownIdentities)) {
    const destinationHash = eventBytes(entry, 'destinationHash');
    const publicKey = eventBytes(entry, 'publicKey');
    if (destinationHash?.byteLength !== 16) continue;
    const hash = bytesToHex(destinationHash);
    const fullDestinationName = publicKey?.byteLength === 64
      ? recognizedFullDestinationName(hash, publicKey)
      : undefined;
    knownByHash.set(hash, {
      destinationHash: hash,
      ...(publicKey?.byteLength === 64 ? { publicKey: bytesToHex(publicKey) } : {}),
      ...(fullDestinationName ? { fullDestinationName } : {}),
    });
  }
  for (const entry of arrayRecords(persistentState.knownDestinations)) {
    const destinationHash = eventBytes(entry, 'destinationHash');
    if (destinationHash?.byteLength !== 16) continue;
    const hash = bytesToHex(destinationHash);
    const lastAnnouncedAt = lastAnnouncedAtByHash.get(hash);
    knownByHash.set(hash, {
      ...knownByHash.get(hash),
      destinationHash: hash,
      ...(lastAnnouncedAt ? { lastAnnouncedAt } : {}),
    });
  }
  for (const [destinationHash, publicKey] of knownDestinationPublicKeys) {
    const current = knownByHash.get(destinationHash);
    const fullDestinationName = recognizedFullDestinationName(destinationHash, publicKey);
    knownByHash.set(destinationHash, {
      ...current,
      destinationHash,
      publicKey: bytesToHex(publicKey),
      ...(fullDestinationName ? { fullDestinationName } : {}),
    });
  }
  const localDestinationHashes = new Set(inDestinationHashes);
  for (const destinationHash of localDestinationHashes) {
    knownByHash.delete(destinationHash);
  }
  const localDestinations = Array.from(localDestinationHashes, (destinationHash) => {
    const fullDestinationName = destinationHash === localLxmfDeliveryDestinationHash
      ? 'lxmf.delivery'
      : identity
        ? recognizedFullDestinationName(destinationHash, identity.publicKey)
        : undefined;
    const lastAnnouncedAt = identity
      ? latestDestinationAnnouncedAt(
          interfaceAnnounceHistory.values(),
          identity.id,
          destinationHash,
        )
      : undefined;
    return {
      destinationHash,
      ...(lastAnnouncedAt ? { lastAnnouncedAt } : {}),
      ...(fullDestinationName ? { fullDestinationName } : {}),
    };
  }).sort((left, right) => (
    (right.lastAnnouncedAt ?? '').localeCompare(left.lastAnnouncedAt ?? '')
    || left.destinationHash.localeCompare(right.destinationHash)
  ));
  const remoteDestinations = Array.from(knownByHash.values()).sort((left, right) => (
    (right.lastAnnouncedAt ?? '').localeCompare(left.lastAnnouncedAt ?? '')
    || left.destinationHash.localeCompare(right.destinationHash)
  ));
  const nextSignature = JSON.stringify([paths, remoteDestinations, localDestinations]);
  if (nextSignature === pathManagementSnapshotSignature) return;
  pathManagementSnapshotSignature = nextSignature;
  emit({
    type: 'pathManagementSnapshot',
    paths,
    remoteDestinations,
    localDestinations,
  });
}

function recognizedFullDestinationName(
  destinationHash: string,
  publicKey: Uint8Array,
): RegisteredFullDestinationName | undefined {
  const cached = knownDestinationFullNames.get(destinationHash);
  if (cached !== undefined) return cached ?? undefined;
  const recognized = registeredFullDestinationNames.find((fullDestinationName) => (
    destinationMatchesFullName(destinationHash, publicKey, fullDestinationName)
  ));
  knownDestinationFullNames.set(destinationHash, recognized ?? null);
  return recognized;
}

function destinationMatchesFullName(
  destinationHash: string,
  publicKey: Uint8Array,
  fullDestinationName: string,
): boolean {
  if (!/^[0-9a-f]{32}$/.test(destinationHash) || publicKey.byteLength !== 64) return false;
  try {
    return bytesToHex(
      ReticulumNode.hashFromNameAndIdentity(fullDestinationName, publicKey),
    ) === destinationHash;
  } catch {
    return false;
  }
}

function arrayRecords(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object')
    : [];
}

function normalizeDestinationHashes(destinationHashes: string[]): Set<string> {
  return new Set(destinationHashes.map(normalizeDestinationHash).filter(
    (hash): hash is string => Boolean(hash),
  ));
}

function applyBlockedDestinationPolicy(): void {
  if (!node) throw new Error('LXMF runtime is not available');
  const hashes = normalizeBlockedDestinationHashes(blockedDestinationHashes);
  blockedDestinationHashes = hashes;
  const packed = new Uint8Array(hashes.length * 16);
  hashes.forEach((hash, index) => packed.set(hexToBytes(hash), index * 16));
  processOutput(node.setLxmfIgnoredDestinations(packed) as WasmOutput);
  closeBlockedLxmfLinks();
  log('debug', 'wasm', 'LXMF_IGNORED_DESTINATIONS_APPLIED', { count: hashes.length });
}

function closeBlockedLxmfLinks(): void {
  for (const [linkId, destinationHash] of Array.from(lxmfLinkDestinations)) {
    closeBlockedLxmfLink(linkId, destinationHash);
  }
}

function closeBlockedLxmfLink(linkId: string, destinationHash: string): boolean {
  if (!node || !blockedDestinationHashes.includes(destinationHash)) return false;

  // Reticulum cannot know the remote LXMF destination before LINKIDENTIFY.
  // Once it is known, close the normal Reticulum link. Core link teardown also
  // fails and removes any active incoming or outgoing Resource on this link,
  // without changing LXMF proof, retry, or Resource semantics.
  lxmfDeliveryLinks.delete(linkId);
  lxmfLinkDestinations.delete(linkId);
  for (const [resourceId, advertisement] of pendingInboundResourceAdvertisements) {
    if (advertisement.linkId === linkId) pendingInboundResourceAdvertisements.delete(resourceId);
  }
  for (const [transferId, transfer] of inboundChatTransfers) {
    if (transfer.linkId === linkId) finishChatInboundTransfer(transferId, 'failed');
  }

  try {
    processOutput(node.closeLink(hexToBytes(linkId)) as WasmOutput);
    log('info', 'wasm', 'LXMF_BLOCKED_LINK_CLOSED', { linkId, destinationHash });
  } catch (error) {
    // The peer or Reticulum timeout handling may have closed the link first.
    // The local LXMF association is still removed, so no Resource is projected
    // into the chat UI for the blocked destination.
    log('debug', 'wasm', 'LXMF_BLOCKED_LINK_ALREADY_CLOSED', {
      linkId,
      destinationHash,
      message: error instanceof Error ? error.message : String(error),
    });
  }
  return true;
}

function emitPropagationNodeSnapshot(): void {
  if (!node) return;
  type WasmKnownPropagationNode = {
    destinationHash?: Uint8Array | number[];
    enabled?: unknown;
    transferLimitKb?: unknown;
    syncLimitKb?: unknown;
    stampCost?: unknown;
    peeringCost?: unknown;
    heardAtMs?: unknown;
    hops?: unknown;
  };
  let values: WasmKnownPropagationNode[] = [];
  try {
    values = node.lxmfPropagationNodes() as WasmKnownPropagationNode[];
  } catch {
    log('warning', 'wasm', 'LXMF_PROPAGATION_SNAPSHOT_FAILED');
    return;
  }
  for (const value of values) {
    const destinationHash = value.destinationHash
      ? new Uint8Array(value.destinationHash)
      : undefined;
    if (!destinationHash || destinationHash.byteLength !== 16) continue;
    const heardAtMs = typeof value.heardAtMs === 'number' && Number.isFinite(value.heardAtMs)
      ? value.heardAtMs
      : 0;
    emit({
      type: 'knownDestinationObserved',
      destinationHash: bytesToHex(destinationHash),
      fullDestinationName: 'lxmf.propagation',
      ...(heardAtMs > 0 ? { lastAnnouncedAt: new Date(heardAtMs).toISOString() } : {}),
      metadata: {
        enabled: value.enabled === true,
        transferLimitKb: typeof value.transferLimitKb === 'number' ? value.transferLimitKb : 0,
        syncLimitKb: typeof value.syncLimitKb === 'number' ? value.syncLimitKb : 0,
        stampCost: typeof value.stampCost === 'number' ? value.stampCost : 0,
        peeringCost: typeof value.peeringCost === 'number' ? value.peeringCost : 0,
      },
    });
  }
}

function cleanupRuntime(alreadyDownRuntimeIndexes: ReadonlySet<number> = new Set()): void {
  stampWork.clear();
  if (tickTimer !== undefined) clearTimeout(tickTimer);
  tickTimer = undefined;
  if (autoAnnounceTimer !== undefined) clearTimeout(autoAnnounceTimer);
  autoAnnounceTimer = undefined;
  if (automaticPropagationSyncTimer !== undefined) clearTimeout(automaticPropagationSyncTimer);
  automaticPropagationSyncTimer = undefined;
  if (statusDetailsTimer !== undefined) clearInterval(statusDetailsTimer);
  statusDetailsTimer = undefined;
  automaticPropagationSyncPending = false;
  finishPropagationSync(false, 'LXMF_PROPAGATION_SYNC_RUNTIME_RESET');
  clearNomadState('NOMAD_RUNTIME_RESET');
  clearProvisioningState('PROVISIONING_RUNTIME_RESET');
  clearProbeState('PROBE_RUNTIME_RESET');
  clearDestinationPathRequests('PATH_REQUEST_RUNTIME_RESET');
  knownDestinationPublicKeys.clear();
  knownDestinationFullNames.clear();
  localLxmfDeliveryDestinationHash = undefined;
  pathManagementSnapshotSignature = '';
  emit({
    type: 'pathManagementSnapshot',
    paths: [],
    remoteDestinations: [],
    localDestinations: [],
  });
  lxmfOutboundStatusCache.clear();
  lxmfDeliveryLinks.clear();
  lxmfLinkDestinations.clear();
  activeLinkIds.clear();
  inboundChatTransfers.clear();
  inboundResourceSegments.clear();
  pendingInboundResourceAdvertisements.clear();
  emit({ type: 'chatInboundTransfersCleared' });
  if (observedDestinationPaths.size) {
    emit({
      type: 'destinationPathStatuses',
      statuses: Array.from(observedDestinationPaths, (destinationHash) => ({
        destinationHash,
        hasPath: false,
      })),
    });
  }
  observedDestinationPaths.clear();
  destinationPathStatusCache.clear();
  for (const driver of drivers.values()) {
    const runtimeIndex = driver.runtimeIndex();
    driver.disconnect(runtimeIndex === undefined || !alreadyDownRuntimeIndexes.has(runtimeIndex));
  }
  drivers.clear();
  node?.free();
  node = undefined;
}

interface ProcessOutputResult {
  lxmfDeliveryDispatched: boolean;
}

interface ProcessOutputOptions {
  suppressAnnounces?: boolean;
  lxmfDeliveryAnnounceFingerprint?: string;
}

function processOutput(
  output?: WasmOutput,
  options?: ProcessOutputOptions,
): ProcessOutputResult {
  const result: ProcessOutputResult = { lxmfDeliveryDispatched: false };
  if (!output) return result;
  const historyUpdates = new Map<string, InterfaceAnnounceHistoryRecord>();
  const announcedAt = new Date().toISOString();
  for (const action of output.actions ?? []) {
    if (
      options?.suppressAnnounces
      && shouldSuppressInterfaceOnlineAnnounce(action.packet)
    ) continue;
    let dispatched = 0;
    const dispatchedDrivers: InterfaceDriver[] = [];
    for (const driver of drivers.values()) {
      if (driver.dispatch(action)) {
        dispatched += 1;
        dispatchedDrivers.push(driver);
      }
    }
    const destinationHash = announcePacketDestinationHash(action.packet);
    if (
      action.packet.packetType === 'announce'
      && destinationHash
      && destinationHash === localLxmfDeliveryDestinationHash
    ) {
      if (dispatchedDrivers.length > 0) {
        result.lxmfDeliveryDispatched = true;
      }
      if (identity && options?.lxmfDeliveryAnnounceFingerprint) {
        for (const driver of dispatchedDrivers) {
          const record = createInterfaceAnnounceHistoryRecord(
            identity.id,
            driver.stableId,
            driver.networkFingerprint,
            destinationHash,
            options.lxmfDeliveryAnnounceFingerprint,
            announcedAt,
          );
          interfaceAnnounceHistory.set(record.id, record);
          historyUpdates.set(record.id, record);
        }
      }
    }
    logNomadProtocolAction(action, dispatched);
  }
  if (historyUpdates.size > 0) {
    emit({
      type: 'persistInterfaceAnnounceHistory',
      records: Array.from(historyUpdates.values()),
    });
  }
  for (const event of output.events ?? []) handleWasmEvent(event);
  if (historyUpdates.size > 0) emitKnownDestinationSnapshot();
  emitLxmfOutboundProgress();
  emitDestinationPathStatuses(Array.from(observedDestinationPaths), false);
  if (output.dirtyPersistentState) queueSnapshotPersistence();
  scheduleNextTick();
  return result;
}

function destinationHasCurrentAnnounce(
  driver: InterfaceDriver,
  destinationHash: string,
  announceFingerprint: string,
): boolean {
  if (!identity) return false;
  const record = interfaceAnnounceHistory.get(interfaceAnnounceHistoryId(
    identity.id,
    driver.stableId,
    driver.networkFingerprint,
    destinationHash,
  ));
  return hasCurrentInterfaceAnnounce(record, announceFingerprint);
}

function normalizedInterfaceAnnounceHistory(
  records: InterfaceAnnounceHistoryRecord[],
): Map<string, InterfaceAnnounceHistoryRecord> {
  const normalized = new Map<string, InterfaceAnnounceHistoryRecord>();
  for (const value of records) {
    const record = normalizeInterfaceAnnounceHistoryRecord(value);
    if (record) normalized.set(record.id, record);
  }
  return normalized;
}

function pruneInterfaceAnnounceHistory(interfaces: InterfaceConfig[]): void {
  const networkFingerprints = new Map(interfaces.map((config) => [
    config.id,
    interfaceNetworkFingerprint(config),
  ]));
  for (const [id, record] of interfaceAnnounceHistory) {
    if (networkFingerprints.get(record.interfaceId) !== record.networkFingerprint) {
      interfaceAnnounceHistory.delete(id);
    }
  }
}

function emitLxmfOutboundProgress(): void {
  if (!node || !identity) return;
  const outbound = node.lxmfOutbound() as unknown;
  if (!Array.isArray(outbound)) return;
  let networkSnapshot: unknown;
  try {
    networkSnapshot = node.exportNetworkPersistentState();
  } catch {
    // Delivery progress remains useful when route presentation is unavailable.
    networkSnapshot = { paths: [] };
  }
  const active = new Set<string>();
  for (const value of outbound) {
    if (!value || typeof value !== 'object') continue;
    const summary = value as Record<string, unknown>;
    const messageIdBytes = eventBytes(summary, 'messageId');
    const state = eventString(summary, 'state');
    const method = eventString(summary, 'method');
    const representation = eventString(summary, 'representation');
    const attempts = eventNumber(summary, 'attempts');
    const maxAttempts = eventNumber(summary, 'maxAttempts');
    const progress = eventNumber(summary, 'progress');
    const destinationHash = eventBytes(summary, 'destinationHash');
    const hasStamp = eventBoolean(summary, 'hasStamp') === true;
    if (!messageIdBytes || !state || !method || !representation
      || attempts === undefined || maxAttempts === undefined || progress === undefined) continue;
    const messageId = bytesToHex(messageIdBytes);
    const destinationHashHex = destinationHash?.byteLength === 16
      ? bytesToHex(destinationHash)
      : undefined;
    const path = destinationHashHex
      ? currentChatMessagePath(destinationHashHex, networkSnapshot)
      : undefined;
    const stamp = destinationHashHex
      ? currentOutboundChatMessageStamp(destinationHashHex, hasStamp)
      : undefined;
    active.add(messageId);
    const signature = `${state}:${method}:${representation}:${attempts}:${maxAttempts}:${progress}`
      + `:${path?.hops ?? ''}:${path?.interfaceId ?? ''}:${path?.interfaceName ?? ''}`
      + `:${stamp?.status ?? ''}:${stamp?.cost ?? ''}`;
    if (lxmfOutboundStatusCache.get(messageId) === signature) continue;
    lxmfOutboundStatusCache.set(messageId, signature);
    emit({
      type: 'chatMessageProgress',
      identityId: identity.id,
      messageId,
      state,
      method,
      representation,
      attempts,
      maxAttempts,
      progress,
      stamp,
      path,
    });
  }
  for (const messageId of lxmfOutboundStatusCache.keys()) {
    if (!active.has(messageId)) lxmfOutboundStatusCache.delete(messageId);
  }
}

function syncLxmfPropagation(requestId: string): void {
  const propagationHash = normalizeDestinationHash(configuration?.preferences.lxmf.propagationNodeHash ?? '');
  if (!node || !identity) {
    rejectPropagationSync(requestId, 'LXMF_RUNTIME_UNAVAILABLE');
    return;
  }
  if (propagationSyncRequestId) {
    rejectPropagationSync(requestId, 'LXMF_PROPAGATION_SYNC_BUSY');
    return;
  }
  if (!Array.from(drivers.values()).some((driver) => driver.state === 'online')) {
    rejectPropagationSync(requestId, 'LXMF_PROPAGATION_SYNC_OFFLINE');
    return;
  }

  propagationSyncRequestId = requestId;
  emitPropagationSyncStatus({ syncing: true });
  try {
    if (propagationHash) {
      processOutput(node.selectLxmfPropagationNode(hexToBytes(propagationHash)) as WasmOutput);
    } else {
      processOutput(node.selectLxmfPropagationNode(undefined) as WasmOutput);
    }
    processOutput(node.requestLxmfMessages() as WasmOutput);
    log('info', 'wasm', 'LXMF_PROPAGATION_SYNC_REQUESTED', {
      preferredDestinationHash: propagationHash ?? 'automatic',
    });
  } catch (error) {
    finishPropagationSync(false, errorCode(error));
  }
}

function rejectPropagationSync(requestId: string, code: string): void {
  emit({ type: 'lxmfPropagationSyncResult', requestId, ok: false, code });
  log('warning', 'wasm', code);
}

function emitPropagationSyncStatus(
  status: Omit<Extract<RuntimeEvent, { type: 'lxmfPropagationSyncStatus' }>, 'type'>,
): void {
  const signature = `${status.syncing}:${status.state ?? ''}:${status.progress ?? ''}:${status.transferSize ?? ''}`;
  if (signature === propagationSyncStatusSignature) return;
  propagationSyncStatusSignature = signature;
  emit({ type: 'lxmfPropagationSyncStatus', ...status });
}

function finishPropagationSync(
  ok: boolean,
  code?: string,
  received?: number,
  duplicates?: number,
): void {
  const requestId = propagationSyncRequestId;
  if (!requestId) return;
  propagationSyncRequestId = undefined;
  emitPropagationSyncStatus({ syncing: false });
  emit({ type: 'lxmfPropagationSyncResult', requestId, ok, code, received, duplicates });
  log(ok ? 'info' : 'warning', 'wasm', ok ? 'LXMF_PROPAGATION_SYNC_COMPLETE' : (code ?? 'LXMF_PROPAGATION_SYNC_FAILED'), {
    received: received ?? 0,
    duplicates: duplicates ?? 0,
  });
}

function announceLxmf(
  source: 'manual' | 'automatic',
  requestedInterface?: InterfaceDriver,
): boolean {
  const onlineDrivers = Array.from(drivers.values())
    .filter((driver) => driver.state === 'online'
      && (!requestedInterface || driver === requestedInterface));
  const requestedInterfaceIndex = requestedInterface?.runtimeIndex();
  if (!node || !identity || onlineDrivers.length === 0
    || (requestedInterface && requestedInterfaceIndex === undefined)) {
    log('warning', 'runtime', `LXMF_ANNOUNCE_${source.toUpperCase()}_SKIPPED_OFFLINE`);
    return false;
  }
  try {
    const stampCost = configuration?.preferences.lxmf.inboundStampCost ?? 0;
    const announceFingerprint = lxmfDeliveryAnnounceFingerprint(identity.displayName, stampCost);
    const result = processOutput(node.announceLxmf({
      displayName: identity.displayName,
      stampCost: stampCost > 0 ? stampCost : undefined,
      compressionSupported: true,
      ...(requestedInterfaceIndex !== undefined ? { interfaceIndex: requestedInterfaceIndex } : {}),
    }) as WasmOutput, {
      lxmfDeliveryAnnounceFingerprint: announceFingerprint,
    });
    if (!result.lxmfDeliveryDispatched) {
      log('warning', 'runtime', `LXMF_ANNOUNCE_${source.toUpperCase()}_SKIPPED_OFFLINE`);
      return false;
    }
    if (!requestedInterface) recordSuccessfulBroadcastAnnounce();
    log('info', 'runtime', `LXMF_ANNOUNCE_${source.toUpperCase()}_SENT`, {
      interfaces: onlineDrivers.map((driver) => driver.stableId).join(','),
      targeted: requestedInterface !== undefined,
    });
    return true;
  } catch {
    log('error', 'runtime', 'RUNTIME_IDENTITY_ANNOUNCE_FAILED');
    emit({ type: 'runtimeError', code: 'RUNTIME_IDENTITY_ANNOUNCE_FAILED' });
    return false;
  }
}

function recordSuccessfulBroadcastAnnounce(): void {
  if (!identity) return;
  const announcedAt = new Date().toISOString();
  const updated: PersistedIdentityRecord = {
    ...identity,
    lastAnnouncedAt: announcedAt,
    updatedAt: announcedAt,
  };
  identity = updated;
  const persistence = persistenceQueue.then(() => requestIdentitySave(updated));
  persistenceQueue = persistence.then(() => undefined, () => undefined);
  void persistence.then((saved) => {
    log(saved ? 'debug' : 'warning', 'persistence', saved
      ? 'LXMF_ANNOUNCE_TIMESTAMP_PERSISTED'
      : 'LXMF_ANNOUNCE_TIMESTAMP_PERSIST_FAILED', {
      announcedAt,
    });
  });
}

function sendLxmfMessage(command: Extract<RuntimeCommand, { type: 'sendLxmfMessage' }>): void {
  const destinationHash = normalizeDestinationHash(command.destinationHash);
  const content = command.content.trim();
  let attachments;
  try {
    attachments = normalizeChatAttachments(command.attachments);
  } catch (error) {
    emit({ type: 'chatMessageQueueFailed', requestId: command.requestId, code: errorCode(error) });
    return;
  }
  if (!node || !identity || !configuration || !destinationHash || (!content && attachments.length === 0)
    || content.length > 65_536) {
    emit({ type: 'chatMessageQueueFailed', requestId: command.requestId, code: 'LXMF_MESSAGE_INVALID' });
    return;
  }
  if (blockedDestinationHashes.includes(destinationHash)) {
    emit({ type: 'chatMessageQueueFailed', requestId: command.requestId, code: 'LXMF_DESTINATION_BLOCKED' });
    return;
  }

  const title = command.title.trim().slice(0, 1_024);
  const timestamp = command.timestamp ?? Date.now() / 1_000;
  const isPropagationFallback = command.propagationFallback === true;
  const deliveryPlan = resolveLxmfDeliveryPlan(configuration.preferences.lxmf);
  let attempt: ReturnType<typeof prepareLxmfAttempt>;
  try {
    const primaryMethod = isPropagationFallback ? 'propagated' : deliveryPlan.method;
    attempt = prepareLxmfAttempt(destinationHash, title, content, attachments, primaryMethod, timestamp);
  } catch (primaryError) {
    if (!isPropagationFallback && deliveryPlan.method !== 'propagated' && deliveryPlan.tryPropagation) {
      try {
        attempt = prepareLxmfAttempt(destinationHash, title, content, attachments, 'propagated', timestamp);
        log('info', 'wasm', 'LXMF_MESSAGE_IMMEDIATE_PROPAGATION_FALLBACK', { destinationHash });
      } catch (fallbackError) {
        const code = errorCode(fallbackError);
        log('error', 'wasm', 'LXMF_MESSAGE_QUEUE_FAILED', { destinationHash, code });
        emit({ type: 'chatMessageQueueFailed', requestId: command.requestId, code });
        return;
      }
    } else {
      const code = errorCode(primaryError);
      log('error', 'wasm', 'LXMF_MESSAGE_QUEUE_FAILED', { destinationHash, code });
      emit({ type: 'chatMessageQueueFailed', requestId: command.requestId, code });
      return;
    }
  }

  const stamp = currentOutboundChatMessageStamp(destinationHash, false);
  emit({
    type: 'chatMessageQueued',
    requestId: command.requestId,
    identityId: identity.id,
    messageId: attempt.messageId,
    sourceHash: attempt.sourceHash,
    destinationHash,
    title,
    content,
    attachments,
    method: attempt.method,
    verification: 'valid',
    ...(stamp ? { stamp } : {}),
    path: currentChatMessagePath(destinationHash),
    propagationFallbackPending: !isPropagationFallback && attempt.method !== 'propagated' && deliveryPlan.tryPropagation,
    replacesMessageId: command.replacesMessageId,
    timestamp: attempt.timestamp,
    queuedAt: new Date(attempt.timestamp * 1_000).toISOString(),
  });
  processOutput(attempt.output);
  log('info', 'wasm', isPropagationFallback ? 'LXMF_MESSAGE_PROPAGATION_FALLBACK_QUEUED' : 'LXMF_MESSAGE_QUEUED', {
    messageId: attempt.messageId,
    destinationHash,
    method: attempt.method,
  });
}

function importLxmaPeer(command: Extract<RuntimeCommand, { type: 'importLxmaPeer' }>): void {
  const address = parseLxmaAddress(command.uri);
  const destinationHash = normalizeDestinationHash(address?.destinationHash ?? '');
  const publicKeyHex = address?.publicKey;
  if (!node || !destinationHash || !publicKeyHex) {
    log('warning', 'wasm', 'LXMF_PEER_IMPORT_REJECTED');
    emit({ type: 'lxmaPeerImportResult', requestId: command.requestId, ok: false, code: 'LXMA_ADDRESS_INVALID' });
    return;
  }

  try {
    const destinationBytes = hexToBytes(destinationHash);
    const publicKey = hexToBytes(publicKeyHex);
    const derivedDestination = ReticulumNode.hashFromNameAndIdentity('lxmf.delivery', publicKey);
    if (!equalBytes(destinationBytes, derivedDestination)) {
      log('warning', 'wasm', 'LXMF_PEER_IMPORT_REJECTED', { destinationHash });
      emit({ type: 'lxmaPeerImportResult', requestId: command.requestId, ok: false, code: 'LXMA_ADDRESS_INVALID' });
      return;
    }
    node.rememberIdentity(destinationBytes, publicKey);
    knownDestinationPublicKeys.set(destinationHash, new Uint8Array(publicKey));
    emit({
      type: 'knownDestinationObserved',
      destinationHash,
      fullDestinationName: 'lxmf.delivery',
    });
    emitKnownDestinationSnapshot();
    queueSnapshotPersistence();
    log('debug', 'wasm', 'LXMF_PEER_IMPORTED', { destinationHash });
    emit({ type: 'lxmaPeerImportResult', requestId: command.requestId, ok: true, destinationHash });
  } catch {
    log('warning', 'wasm', 'LXMF_PEER_IMPORT_REJECTED', { destinationHash });
    emit({ type: 'lxmaPeerImportResult', requestId: command.requestId, ok: false, code: 'LXMA_ADDRESS_INVALID' });
  }
}

function cancelLxmfMessage(command: Extract<RuntimeCommand, { type: 'cancelLxmfMessage' }>): void {
  if (!node || !/^[0-9a-f]{64}$/i.test(command.messageId)) {
    emit({ type: 'chatMessageOperationResult', requestId: command.requestId, ok: false, code: 'LXMF_MESSAGE_INVALID' });
    return;
  }
  try {
    processOutput(node.cancelLxmf(hexToBytes(command.messageId)) as WasmOutput);
    lxmfOutboundStatusCache.delete(command.messageId.toLowerCase());
    emit({ type: 'chatMessageOperationResult', requestId: command.requestId, ok: true });
    log('info', 'wasm', 'LXMF_MESSAGE_CANCELLED', { messageId: command.messageId });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // A terminal-state race means there is no longer anything to abort. It is
    // still safe for the frontend to remove its local copy.
    if (message.includes('NotFound')) {
      emit({ type: 'chatMessageOperationResult', requestId: command.requestId, ok: true });
      log('debug', 'wasm', 'LXMF_MESSAGE_CANCEL_NOT_NEEDED', { messageId: command.messageId });
      return;
    }
    emit({ type: 'chatMessageOperationResult', requestId: command.requestId, ok: false, code: 'LXMF_MESSAGE_CANCEL_FAILED' });
    log('warning', 'wasm', 'LXMF_MESSAGE_CANCEL_FAILED', { messageId: command.messageId, message });
  }
}

function prepareLxmfAttempt(
  destinationHash: string,
  title: string,
  content: string,
  attachments: Extract<RuntimeCommand, { type: 'sendLxmfMessage' }>['attachments'],
  method: 'direct' | 'opportunistic' | 'propagated',
  timestamp: number,
): { messageId: string; sourceHash: string; method: string; timestamp: number; output: WasmOutput } {
  if (!node) throw new Error('RUNTIME_NOT_READY');
  if (method === 'propagated') {
    const preferred = normalizeDestinationHash(configuration?.preferences.lxmf.propagationNodeHash ?? '');
    processOutput(node.selectLxmfPropagationNode(preferred ? hexToBytes(preferred) : undefined) as WasmOutput);
  }
  let prepared: ReturnType<ReticulumNode['prepareLxmfMessage']> | undefined;
  try {
    prepared = node.prepareLxmfMessage({
      destinationHash: hexToBytes(destinationHash),
      title: new TextEncoder().encode(title),
      content: new TextEncoder().encode(content),
      fields: [],
      attachments: lxmfAttachmentInput(attachments),
      method,
      timestamp,
      includeTicket: true,
    });
    return {
      messageId: bytesToHex(prepared.messageId()),
      sourceHash: bytesToHex(prepared.sourceHash()),
      method: prepared.method(),
      timestamp: prepared.timestamp(),
      output: node.enqueueLxmf(prepared) as WasmOutput,
    };
  } finally {
    prepared?.free();
  }
}

function emitNomadPageProgress(
  job: NomadPageJob,
  stage: NomadPageLoadStage,
  details: { progress?: number; dataSize?: number } = {},
): void {
  emit({
    type: 'nomadPageProgress',
    requestId: job.requestId,
    stage,
    ...details,
  });
}

function probeDestination(command: Extract<RuntimeCommand, { type: 'probeDestination' }>): void {
  const destinationHash = normalizeDestinationHash(command.destinationHash);
  const fullDestinationName = command.fullDestinationName.trim();
  const validName = fullDestinationName.length > 0
    && fullDestinationName.split('.').every((component) => component.length > 0);
  const validTimeout = Number.isSafeInteger(command.timeoutMs)
    && command.timeoutMs > 0
    && command.timeoutMs <= maxTimerDelayMs;
  const validSize = Number.isSafeInteger(command.probeSizeBytes)
    && command.probeSizeBytes >= 0
    && command.probeSizeBytes <= maximumProbePayloadBytes;
  if (!node || !identity || !destinationHash || !validName || !validTimeout || !validSize) {
    emit({
      type: 'probeResult',
      requestId: command.requestId,
      ok: false,
      destinationHash: destinationHash ?? command.destinationHash.trim().toLowerCase(),
      fullDestinationName,
      probeSizeBytes: command.probeSizeBytes,
      code: 'PROBE_INVALID',
    });
    return;
  }

  const job: ProbeJob = {
    requestId: command.requestId,
    sourceDestinationHash: destinationHash,
    destinationHash,
    fullDestinationName,
    timeoutMs: command.timeoutMs,
    probeSizeBytes: command.probeSizeBytes,
    phase: 'findingPath',
  };
  probeJobs.set(job.requestId, job);

  try {
    deriveProbeDestination(job);
    continueProbe(job);
  } catch {
    failProbe(job, 'PROBE_PATH_REQUEST_FAILED');
  }
}

function dropDestinationPath(command: Extract<RuntimeCommand, { type: 'dropDestinationPath' }>): void {
  const destinationHash = normalizeDestinationHash(command.destinationHash);
  if (!node || !destinationHash) {
    emit({ type: 'destinationPathDropResult', requestId: command.requestId, ok: false, code: 'PATH_DROP_INVALID' });
    return;
  }
  try {
    const dropped = node.dropPath(hexToBytes(destinationHash));
    if (dropped) {
      queueSnapshotPersistence();
      emitDestinationPathStatus(hexToBytes(destinationHash), false);
      emitKnownDestinationSnapshot();
      log('info', 'wasm', 'RETICULUM_PATH_DROPPED', { destinationHash });
    }
    emit({
      type: 'destinationPathDropResult',
      requestId: command.requestId,
      ok: dropped,
      ...(dropped ? {} : { code: 'PATH_NOT_FOUND' }),
    });
  } catch {
    emit({ type: 'destinationPathDropResult', requestId: command.requestId, ok: false, code: 'PATH_DROP_FAILED' });
  }
}

function requestDestinationPath(
  command: Extract<RuntimeCommand, { type: 'requestDestinationPath' }>,
): void {
  const destinationHash = normalizeDestinationHash(command.destinationHash);
  if (!node || !destinationHash) {
    emit({
      type: 'destinationPathRequestResult',
      requestId: command.requestId,
      ok: false,
      destinationHash: destinationHash ?? command.destinationHash.trim().toLowerCase(),
      code: 'PATH_REQUEST_INVALID',
    });
    return;
  }
  const job: DestinationPathRequestJob = {
    requestId: command.requestId,
    destinationHash,
    timer: setTimeout(() => {
      finishDestinationPathRequest(command.requestId, false, undefined, 'PATH_REQUEST_TIMEOUT');
    }, pathRequestTimeoutMs),
  };
  destinationPathRequestJobs.set(command.requestId, job);
  try {
    observedDestinationPaths.add(destinationHash);
    processOutput(node.requestPath(hexToBytes(destinationHash)) as WasmOutput);
    emitDestinationPathStatuses([destinationHash]);
    emitKnownDestinationSnapshot();
    log('info', 'wasm', 'RETICULUM_PATH_REQUESTED', { destinationHash });
  } catch {
    finishDestinationPathRequest(command.requestId, false, undefined, 'PATH_REQUEST_FAILED');
  }
}

function resolveDestinationPathRequests(destinationHash: string, hops?: number): void {
  for (const job of Array.from(destinationPathRequestJobs.values())) {
    if (job.destinationHash === destinationHash) {
      finishDestinationPathRequest(job.requestId, true, hops);
    }
  }
}

function finishDestinationPathRequest(
  requestId: string,
  ok: boolean,
  hops?: number,
  code?: string,
): void {
  const job = destinationPathRequestJobs.get(requestId);
  if (!job || !destinationPathRequestJobs.delete(requestId)) return;
  clearTimeout(job.timer);
  emit({
    type: 'destinationPathRequestResult',
    requestId,
    ok,
    destinationHash: job.destinationHash,
    ...(ok && hops !== undefined ? { hops } : {}),
    ...(!ok && code ? { code } : {}),
  });
  log(ok ? 'info' : 'warning', 'wasm', ok ? 'RETICULUM_PATH_REQUEST_SUCCEEDED' : code ?? 'PATH_REQUEST_FAILED', {
    destinationHash: job.destinationHash,
    ...(hops !== undefined ? { hops } : {}),
  });
}

function clearDestinationPathRequests(code: string): void {
  for (const job of Array.from(destinationPathRequestJobs.values())) {
    finishDestinationPathRequest(job.requestId, false, undefined, code);
  }
}

function clearDestinationPaths(requestId: string): void {
  if (!node) {
    emit({ type: 'pathManagementOperationResult', requestId, ok: false, code: 'PATH_CLEAR_INVALID' });
    return;
  }
  try {
    const snapshot = node.exportNetworkPersistentState() as Record<string, unknown>;
    const destinations = arrayRecords(snapshot.paths).flatMap((entry) => {
      const destinationHash = eventBytes(entry, 'destinationHash');
      return destinationHash?.byteLength === 16 ? [destinationHash] : [];
    });
    let count = 0;
    for (const destinationHash of destinations) {
      if (!node.dropPath(destinationHash)) continue;
      count += 1;
      emitDestinationPathStatus(destinationHash, false);
    }
    if (count > 0) queueSnapshotPersistence();
    emitKnownDestinationSnapshot();
    log('info', 'wasm', 'RETICULUM_PATHS_CLEARED', { count });
    emit({ type: 'pathManagementOperationResult', requestId, ok: true, count });
  } catch {
    emit({ type: 'pathManagementOperationResult', requestId, ok: false, code: 'PATH_CLEAR_FAILED' });
  }
}

async function forgetKnownDestinations(requestId: string, requested?: string[]): Promise<void> {
  if (!node || !wrappingKey) {
    emit({ type: 'pathManagementOperationResult', requestId, ok: false, code: 'DESTINATION_FORGET_INVALID' });
    return;
  }
  const operation = persistenceQueue.then(async () => {
    if (!node || !wrappingKey) return false;
    const snapshot = node.exportNetworkPersistentState() as Record<string, unknown>;
    const targets = requested
      ? normalizeDestinationHashes(requested)
      : knownDestinationHashesFromSnapshot(snapshot);
    if (targets.size === 0) {
      emit({ type: 'pathManagementOperationResult', requestId, ok: true, count: 0 });
      return true;
    }
    const knownBefore = knownDestinationHashesFromSnapshot(snapshot);
    const matchingTargets = new Set(Array.from(targets).filter((hash) => knownBefore.has(hash)));
    if (matchingTargets.size === 0) {
      emit({
        type: 'pathManagementOperationResult',
        requestId,
        ok: false,
        code: 'DESTINATION_NOT_FOUND',
      });
      return false;
    }
    const filtered = filterNetworkSnapshot(snapshot, matchingTargets);
    const now = new Date().toISOString();
    const updatedNetworkState: PersistedNetworkStateRecord = {
      schemaVersion: 1,
      encryptedSnapshot: await encrypt(encodeSnapshot(filtered)),
      updatedAt: now,
    };
    if (!await requestNetworkStateSave(updatedNetworkState)) {
      emit({
        type: 'pathManagementOperationResult',
        requestId,
        ok: false,
        code: 'DESTINATION_FORGET_PERSIST_FAILED',
      });
      return false;
    }
    persistedNetworkState = updatedNetworkState;
    await rebuildRuntime(false);
    log('info', 'wasm', 'RETICULUM_DESTINATIONS_FORGOTTEN', { count: matchingTargets.size });
    emit({
      type: 'pathManagementOperationResult',
      requestId,
      ok: true,
      count: matchingTargets.size,
    });
    return true;
  });
  persistenceQueue = operation.then(() => undefined, () => undefined);
  try {
    await operation;
  } catch {
    emit({
      type: 'pathManagementOperationResult',
      requestId,
      ok: false,
      code: 'DESTINATION_FORGET_FAILED',
    });
  }
}

function knownDestinationHashesFromSnapshot(snapshot: Record<string, unknown>): Set<string> {
  const hashes = new Set<string>(knownDestinationPublicKeys.keys());
  for (const collectionName of ['knownIdentities', 'knownDestinations']) {
    for (const entry of arrayRecords(snapshot[collectionName])) {
      const destinationHash = eventBytes(entry, 'destinationHash');
      if (destinationHash?.byteLength === 16) hashes.add(bytesToHex(destinationHash));
    }
  }
  return hashes;
}

function filterNetworkSnapshot(
  snapshot: Record<string, unknown>,
  destinationHashes: ReadonlySet<string>,
): Record<string, unknown> {
  const next = { ...snapshot };
  for (const collectionName of [
    'knownIdentities',
    'knownRatchets',
    'knownDestinations',
    'paths',
    'propagationNodes',
  ]) {
    next[collectionName] = arrayRecords(snapshot[collectionName]).filter((entry) => {
      const destinationHash = eventBytes(entry, 'destinationHash');
      return destinationHash?.byteLength !== 16 || !destinationHashes.has(bytesToHex(destinationHash));
    });
  }
  return next;
}

function cancelProbe(requestId: string): void {
  const job = probeJobs.get(requestId);
  if (!job || !probeJobs.delete(requestId)) return;
  clearProbeTimer(job);
  if (job.packetHash) probeJobsByPacketHash.delete(job.packetHash);
  log('debug', 'wasm', 'PROBE_CANCELLED', { destinationHash: job.destinationHash });
}

function sendPendingProbes(destinationHash: string): void {
  for (const job of probeJobs.values()) {
    if (job.destinationHash === destinationHash && job.phase === 'findingPath') sendProbe(job);
  }
}

function continueProbe(job: ProbeJob): void {
  if (!node || !probeJobs.has(job.requestId) || job.phase !== 'findingPath') return;
  const destinationBytes = hexToBytes(job.destinationHash);
  if (node.hasPath(destinationBytes)) {
    sendProbe(job);
    return;
  }
  clearProbeTimer(job);
  job.timer = setTimeout(() => failProbe(job, 'PROBE_PATH_REQUEST_TIMEOUT'), pathRequestTimeoutMs);
  processOutput(node.requestPath(destinationBytes) as WasmOutput);
  log('debug', 'wasm', 'RETICULUM_PATH_REQUESTED', {
    destinationHash: job.destinationHash,
    sourceDestinationHash: job.sourceDestinationHash,
    purpose: 'probe',
  });
}

function deriveProbeDestination(job: ProbeJob): boolean {
  if (!node) return false;
  const publicKey = job.publicKey ?? knownDestinationPublicKeys.get(job.sourceDestinationHash);
  if (!publicKey) return false;
  const derivedDestination = new Uint8Array(
    ReticulumNode.hashFromNameAndIdentity(job.fullDestinationName, publicKey),
  );
  if (derivedDestination.byteLength !== 16) throw new Error('Derived probe destination hash is invalid');
  const derivedDestinationHash = bytesToHex(derivedDestination);
  job.destinationHash = derivedDestinationHash;
  job.publicKey = new Uint8Array(publicKey);
  node.rememberIdentity(derivedDestination, publicKey);
  knownDestinationPublicKeys.set(derivedDestinationHash, new Uint8Array(publicKey));
  emitKnownDestinationSnapshot();
  return true;
}

function sendProbe(job: ProbeJob): void {
  if (!node || !probeJobs.has(job.requestId) || job.phase !== 'findingPath') return;
  clearProbeTimer(job);
  const previousDestinationHash = job.destinationHash;
  if (!deriveProbeDestination(job)) {
    failProbe(job, 'PROBE_DESTINATION_UNKNOWN');
    return;
  }
  if (job.destinationHash !== previousDestinationHash) {
    continueProbe(job);
    return;
  }
  try {
    Object.assign(job, resolveProbeRoute(
      node.exportNetworkPersistentState(),
      job.destinationHash,
      configuration?.interfaces ?? [],
      stableInterfaceId,
    ));
  } catch {
    // Route presentation metadata must never prevent the probe itself.
  }
  try {
    const destinationBytes = hexToBytes(job.destinationHash);
    const output = node.sendSinglePacket(
      destinationBytes,
      crypto.getRandomValues(new Uint8Array(job.probeSizeBytes)),
    ) as WasmOutput;
    const packetHash = submittedPacketHash(output);
    if (!packetHash) {
      failProbe(job, 'PROBE_SUBMISSION_FAILED');
      return;
    }

    job.phase = 'awaitingProof';
    job.packetHash = bytesToHex(packetHash);
    job.sentAtMs = performance.now();
    probeJobsByPacketHash.set(job.packetHash, job);
    job.timer = setTimeout(() => failProbe(job, 'PROBE_TIMEOUT'), job.timeoutMs);
    processOutput(output);
    log('info', 'wasm', 'PROBE_SENT', {
      destinationHash: job.destinationHash,
      fullDestinationName: job.fullDestinationName,
      packetHash: job.packetHash,
      bytes: job.probeSizeBytes,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    failProbe(job, /too large|TooLarge/i.test(message) ? 'PROBE_SIZE_TOO_LARGE' : 'PROBE_SUBMISSION_FAILED');
  }
}

function submittedPacketHash(output: WasmOutput): Uint8Array | undefined {
  for (let index = (output.events?.length ?? 0) - 1; index >= 0; index -= 1) {
    const event = output.events?.[index];
    if (event?.type !== 'packetSubmitted') continue;
    const packetHash = eventBytes(event, 'packetHash');
    if (packetHash?.byteLength) return packetHash;
  }
  return undefined;
}

function handleProbeDeliveryConfirmed(event: Record<string, unknown>): void {
  const packetHash = eventBytes(event, 'packetHash');
  if (!packetHash) return;
  const job = probeJobsByPacketHash.get(bytesToHex(packetHash));
  if (!job || job.sentAtMs === undefined) return;
  const destinationBytes = hexToBytes(job.destinationHash);
  const hops = node?.hopsTo(destinationBytes);
  finishProbe(job, {
    ok: true,
    roundTripTimeMs: Math.max(0, performance.now() - job.sentAtMs),
    ...(typeof hops === 'number' ? { hops } : {}),
  });
}

function handleProbeDeliveryFailed(event: Record<string, unknown>): void {
  const packetHash = eventBytes(event, 'packetHash');
  if (!packetHash) return;
  const job = probeJobsByPacketHash.get(bytesToHex(packetHash));
  if (job) failProbe(job, 'PROBE_DELIVERY_FAILED');
}

function failProbe(job: ProbeJob, code: string): void {
  finishProbe(job, { ok: false, code });
}

function finishProbe(
  job: ProbeJob,
  result: { ok: boolean; roundTripTimeMs?: number; hops?: number; code?: string },
): void {
  if (!probeJobs.delete(job.requestId)) return;
  clearProbeTimer(job);
  if (job.packetHash) probeJobsByPacketHash.delete(job.packetHash);
  emit({
    type: 'probeResult',
    requestId: job.requestId,
    destinationHash: job.destinationHash,
    fullDestinationName: job.fullDestinationName,
    probeSizeBytes: job.probeSizeBytes,
    ...(job.viaHash ? { viaHash: job.viaHash } : {}),
    ...(job.interfaceName ? { interfaceName: job.interfaceName } : {}),
    ...(job.interfaceType ? { interfaceType: job.interfaceType } : {}),
    ...result,
  });
  log(result.ok ? 'info' : 'warning', 'wasm', result.ok ? 'PROBE_REPLY_RECEIVED' : (result.code ?? 'PROBE_FAILED'), {
    destinationHash: job.destinationHash,
    ...(result.roundTripTimeMs !== undefined ? { roundTripTimeMs: result.roundTripTimeMs } : {}),
    ...(result.hops !== undefined ? { hops: result.hops } : {}),
    ...(job.viaHash ? { viaHash: job.viaHash } : {}),
    ...(job.interfaceName ? { interfaceName: job.interfaceName } : {}),
    ...(job.interfaceType ? { interfaceType: job.interfaceType } : {}),
  });
}

function clearProbeTimer(job: ProbeJob): void {
  if (job.timer === undefined) return;
  clearTimeout(job.timer);
  job.timer = undefined;
}

function clearProbeState(code: string): void {
  for (const job of Array.from(probeJobs.values())) failProbe(job, code);
  probeJobsByPacketHash.clear();
}

function requestNomadPage(command: Extract<RuntimeCommand, { type: 'requestNomadPage' }>): void {
  const destinationHash = normalizeDestinationHash(command.destinationHash);
  if (!node || !identity || !destinationHash) {
    emit({ type: 'nomadPageFailed', requestId: command.requestId, code: 'NOMAD_DESTINATION_UNKNOWN' });
    return;
  }
  const knownPublicKey = knownDestinationPublicKeys.get(destinationHash);
  // A browser reload is a hard navigation boundary: discard every request and
  // transfer associated with the previous session, close that Link in the
  // Reticulum core, and only then create the replacement job. Keeping this in
  // one worker command prevents a reload from racing with ordinary Link reuse.
  if (command.freshLink) {
    cancelNomadPage(destinationHash, true);
    log('info', 'wasm', 'NOMAD_HARD_RELOAD_STARTED', { destinationHash });
  }
  const job: NomadPageJob = {
    requestId: command.requestId,
    destinationHash,
    path: nomadRequestPath(command.path),
    requestData: { ...(command.requestData ?? {}) },
    publicKey: knownPublicKey ? bytesToHex(knownPublicKey) : undefined,
    identifyBeforeRequest: command.identifyBeforeRequest === true,
    recoveryAttempts: 0,
    startedAt: Date.now(),
  };
  let knownHops: number | undefined;
  try {
    const destinationBytes = hexToBytes(destinationHash);
    if (node.hasPath(destinationBytes)) knownHops = node.hopsTo(destinationBytes);
  } catch {
    // The request validation below reports malformed or unavailable paths.
  }
  armNomadPageDeadline(job, knownHops);
  sweepNomadLinks();
  const link = nomadLinksByDestination.get(destinationHash);
  if (link?.established) {
    sendNomadRequest(link, job);
    return;
  }
  const pending = nomadPendingJobs.get(destinationHash) ?? [];
  pending.push(job);
  nomadPendingJobs.set(destinationHash, pending);
  if (link) {
    emitNomadPageProgress(job, 'establishingLink');
    return;
  }
  try {
    const destinationBytes = hexToBytes(destinationHash);
    if (job.publicKey && node.hasPath(destinationBytes)) {
      beginNomadLink(job.destinationHash, job.publicKey);
    }
    else {
      emitNomadPageProgress(job, 'findingPath');
      armNomadPathDiscoveryTimeout(job);
      processOutput(node.requestPath(destinationBytes) as WasmOutput);
      log('debug', 'wasm', 'RETICULUM_PATH_REQUESTED', {
        destinationHash,
        purpose: 'nomadPage',
        reason: 'noCachedPath',
        recoveryAttempt: 0,
      });
    }
  } catch {
    failNomadDestination(destinationHash, 'NOMAD_PATH_REQUEST_FAILED');
    failNomadLinkEstablishmentDestination(destinationHash, 'NOMAD_PATH_REQUEST_FAILED');
  }
}

function cancelNomadPage(destination: string, closeLink: boolean): void {
  const destinationHash = normalizeDestinationHash(destination);
  if (!destinationHash) return;
  const jobs = new Set(nomadPendingJobs.get(destinationHash) ?? []);
  nomadPendingJobs.delete(destinationHash);
  for (const [requestId, job] of Array.from(nomadRequests.entries())) {
    if (job.destinationHash !== destinationHash) continue;
    nomadRequests.delete(requestId);
    jobs.add(job);
  }
  for (const job of jobs) {
    clearNomadJobTimers(job);
    emit({ type: 'nomadPageFailed', requestId: job.requestId, code: 'NOMAD_PAGE_CANCELLED' });
  }
  const link = nomadLinksByDestination.get(destinationHash);
  if (link && closeLink) retireNomadLink(destinationHash, bytesToHex(link.linkId));
  else if (link && node) {
    try {
      processOutput(node.rejectResource(link.linkId) as WasmOutput);
      log('debug', 'wasm', 'NOMAD_PAGE_RESOURCE_REJECTED', {
        destinationHash,
        linkId: bytesToHex(link.linkId),
      });
    } catch {
      // The page resource may already be transferring or no advertisement may
      // be pending. The cancelled job is still detached while the link stays.
    }
  }
  log('info', 'wasm', 'NOMAD_PAGE_LOAD_CANCELLED', {
    destinationHash,
    jobs: jobs.size,
    linkClosed: Boolean(link && closeLink),
    linkRetained: Boolean(link && !closeLink),
  });
}

function establishNomadLink(
  command: Extract<RuntimeCommand, { type: 'establishNomadLink' }>,
): void {
  const destinationHash = normalizeDestinationHash(command.destinationHash);
  if (!destinationHash || !node || !identity) {
    emit({
      type: 'nomadLinkResult',
      requestId: command.requestId,
      ok: false,
      code: 'NOMAD_DESTINATION_UNKNOWN',
    });
    return;
  }

  sweepNomadLinks();
  const activeLink = nomadLinksByDestination.get(destinationHash);
  if (activeLink?.established) {
    activeLink.lastUsedAt = Date.now();
    emit({ type: 'nomadLinkResult', requestId: command.requestId, ok: true });
    return;
  }

  const knownPublicKey = knownDestinationPublicKeys.get(destinationHash);
  const job: NomadLinkEstablishmentJob = {
    requestId: command.requestId,
    destinationHash,
    publicKey: knownPublicKey ? bytesToHex(knownPublicKey) : undefined,
    startedAt: Date.now(),
  };
  let knownHops: number | undefined;
  try {
    const destinationBytes = hexToBytes(destinationHash);
    if (node.hasPath(destinationBytes)) knownHops = node.hopsTo(destinationBytes);
  } catch {
    // Validation and path failures are reported below.
  }
  armNomadLinkEstablishmentDeadline(job, knownHops);
  const pending = nomadLinkEstablishmentJobs.get(destinationHash) ?? [];
  pending.push(job);
  nomadLinkEstablishmentJobs.set(destinationHash, pending);

  // A page request may already be establishing this destination's link. The
  // link-established event resolves both kinds of waiter without sending an
  // additional page request.
  if (activeLink) return;
  if (pending.length > 1) {
    armNomadLinkEstablishmentPathTimeout(job);
    return;
  }

  try {
    const destinationBytes = hexToBytes(destinationHash);
    if (job.publicKey && node.hasPath(destinationBytes)) {
      beginNomadLink(destinationHash, job.publicKey);
    } else {
      armNomadLinkEstablishmentPathTimeout(job);
      processOutput(node.requestPath(destinationBytes) as WasmOutput);
      log('debug', 'wasm', 'RETICULUM_PATH_REQUESTED', {
        destinationHash,
        purpose: 'nomadLink',
        reason: 'noCachedPath',
      });
    }
  } catch {
    failNomadLinkEstablishment(job, 'NOMAD_PATH_REQUEST_FAILED');
  }
}

function identifyNomadLink(command: Extract<RuntimeCommand, { type: 'identifyNomadLink' }>): void {
  const destinationHash = normalizeDestinationHash(command.destinationHash);
  if (!destinationHash || !node || !identity) {
    emit({ type: 'nomadIdentityResult', requestId: command.requestId, ok: false, code: 'NOMAD_LINK_NOT_ACTIVE' });
    return;
  }
  const link = nomadLinksByDestination.get(destinationHash);
  if (!link?.established) {
    emit({ type: 'nomadIdentityResult', requestId: command.requestId, ok: false, code: 'NOMAD_LINK_NOT_ACTIVE' });
    return;
  }
  try {
    processOutput(node.identifyLink(link.linkId) as WasmOutput);
    link.identified = true;
    link.lastUsedAt = Date.now();
    emitNomadLinkStatus(link.destinationHash);
    log('info', 'wasm', 'NOMAD_IDENTITY_SHARED', {
      destinationHash,
      linkId: bytesToHex(link.linkId),
    });
    emit({ type: 'nomadIdentityResult', requestId: command.requestId, ok: true });
    log('debug', 'wasm', 'NOMAD_IDENTITY_RESULT_EMITTED', {
      requestId: command.requestId,
      ok: true,
    });
  } catch (error) {
    emit({ type: 'nomadIdentityResult', requestId: command.requestId, ok: false, code: 'NOMAD_IDENTITY_SHARE_FAILED' });
    log('warning', 'wasm', 'NOMAD_IDENTITY_SHARE_FAILED', {
      destinationHash,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

function emitNomadLinkStatus(destinationHash: string): void {
  const link = nomadLinksByDestination.get(destinationHash);
  emit({
    type: 'nomadLinkStatusChanged',
    destinationHash,
    active: link?.established === true,
    identified: link?.established === true && link.identified,
  });
}

function beginNomadLink(destinationHash: string, publicKey: string): void {
  if (!node || nomadLinksByDestination.has(destinationHash)) return;
  for (const pending of nomadPendingJobs.get(destinationHash) ?? []) {
    clearNomadJobTimer(pending);
    emitNomadPageProgress(pending, 'establishingLink');
  }
  for (const pending of nomadLinkEstablishmentJobs.get(destinationHash) ?? []) {
    clearNomadLinkEstablishmentPathTimer(pending);
  }
  try {
    const result = connectReticulumDestination(destinationHash, publicKey);
    const state: NomadLinkState = {
      destinationHash,
      linkId: new Uint8Array(result.linkId),
      established: false,
      everEstablished: false,
      identified: false,
      lastUsedAt: Date.now(),
    };
    nomadLinksByDestination.set(state.destinationHash, state);
    nomadLinksById.set(bytesToHex(state.linkId), state);
    emitNomadLinkStatus(state.destinationHash);
    processOutput(result.output);
    log('debug', 'wasm', 'NOMAD_LINK_ESTABLISHING', {
      destinationHash: state.destinationHash,
      linkId: bytesToHex(state.linkId),
    });
  } catch {
    failNomadDestination(destinationHash, 'NOMAD_LINK_FAILED');
    failNomadLinkEstablishmentDestination(destinationHash, 'NOMAD_LINK_FAILED');
  }
}

function connectReticulumDestination(
  destinationHash: string,
  publicKey: string,
): { linkId: Uint8Array; output: WasmOutput } {
  if (!node) throw new Error('RUNTIME_NOT_READY');
  return node.connect(
    hexToBytes(destinationHash),
    hexToBytes(publicKey).slice(32, 64),
  ) as { linkId: Uint8Array; output: WasmOutput };
}

function sendNomadRequest(link: NomadLinkState, job: NomadPageJob): void {
  if (!node) return failNomadJob(job, 'NOMAD_RUNTIME_UNAVAILABLE');
  clearNomadJobTimer(job);
  if (job.identifyBeforeRequest && !link.identified) {
    try {
      processOutput(node.identifyLink(link.linkId) as WasmOutput);
      link.identified = true;
      link.lastUsedAt = Date.now();
      emitNomadLinkStatus(link.destinationHash);
      log('info', 'wasm', 'NOMAD_PAGE_IDENTITY_SHARED', {
        destinationHash: job.destinationHash,
        linkId: bytesToHex(link.linkId),
      });
    } catch {
      failNomadJob(job, 'NOMAD_IDENTITY_SHARE_FAILED');
      return;
    }
  }
  try {
    // Let Reticulum derive the request timeout from the established link RTT,
    // matching Python Link.request(timeout=None). Fixed short timeouts reject
    // valid responses on slow and multi-hop LoRa paths.
    // Python NomadNet sends submitted fields and preset variables as one
    // MessagePack map. An empty request is therefore 0x80, never nil.
    const result = node.sendRequest(
      link.linkId,
      job.path,
      encodeNomadRequestData(job.requestData),
      undefined,
    ) as {
      hash: Uint8Array;
      output: WasmOutput;
    };
    link.lastUsedAt = Date.now();
    job.linkId = bytesToHex(link.linkId);
    const requestId = bytesToHex(new Uint8Array(result.hash));
    nomadRequests.set(requestId, job);
    processOutput(result.output);
    emitNomadPageProgress(job, 'requestingPage');
    log('info', 'wasm', 'NOMAD_PAGE_REQUESTED', {
      destinationHash: job.destinationHash,
      path: job.path,
      linkId: bytesToHex(link.linkId),
      requestId,
      recoveryAttempt: job.recoveryAttempts,
    });
  } catch {
    failNomadJob(job, 'NOMAD_REQUEST_FAILED');
  }
}

function clearNomadLinkEstablishmentPathTimer(job: NomadLinkEstablishmentJob): void {
  if (job.pathTimer === undefined) return;
  clearTimeout(job.pathTimer);
  job.pathTimer = undefined;
}

function clearNomadLinkEstablishmentDeadline(job: NomadLinkEstablishmentJob): void {
  if (job.deadlineTimer === undefined) return;
  clearTimeout(job.deadlineTimer);
  job.deadlineTimer = undefined;
}

function clearNomadLinkEstablishmentTimers(job: NomadLinkEstablishmentJob): void {
  clearNomadLinkEstablishmentPathTimer(job);
  clearNomadLinkEstablishmentDeadline(job);
}

function armNomadLinkEstablishmentPathTimeout(job: NomadLinkEstablishmentJob): void {
  clearNomadLinkEstablishmentPathTimer(job);
  job.pathTimer = setTimeout(
    () => failNomadLinkEstablishment(
      job,
      job.publicKey ? 'NOMAD_PATH_REQUEST_TIMEOUT' : 'NOMAD_DESTINATION_UNKNOWN',
    ),
    pathRequestTimeoutMs,
  );
}

function armNomadLinkEstablishmentDeadline(
  job: NomadLinkEstablishmentJob,
  hops?: number,
): void {
  const deadlineAt = job.startedAt + nomadPageLoadDeadlineMs(hops);
  if (job.deadlineAt !== undefined && job.deadlineAt >= deadlineAt) return;
  clearNomadLinkEstablishmentDeadline(job);
  job.deadlineAt = deadlineAt;
  job.deadlineTimer = setTimeout(
    () => failNomadLinkEstablishment(job, 'NOMAD_LINK_ESTABLISHMENT_FAILED'),
    Math.max(0, deadlineAt - Date.now()),
  );
}

function failNomadLinkEstablishment(job: NomadLinkEstablishmentJob, code: string): void {
  clearNomadLinkEstablishmentTimers(job);
  const pending = nomadLinkEstablishmentJobs.get(job.destinationHash) ?? [];
  const remaining = pending.filter((item) => item !== job);
  if (remaining.length) nomadLinkEstablishmentJobs.set(job.destinationHash, remaining);
  else nomadLinkEstablishmentJobs.delete(job.destinationHash);
  closeIdleNomadLink(job.destinationHash);
  emit({ type: 'nomadLinkResult', requestId: job.requestId, ok: false, code });
  log('warning', 'wasm', code, { destinationHash: job.destinationHash });
}

function failNomadLinkEstablishmentDestination(destinationHash: string, code: string): void {
  const jobs = nomadLinkEstablishmentJobs.get(destinationHash) ?? [];
  nomadLinkEstablishmentJobs.delete(destinationHash);
  for (const job of jobs) failNomadLinkEstablishment(job, code);
}

function finishNomadLinkEstablishment(destinationHash: string): void {
  const jobs = nomadLinkEstablishmentJobs.get(destinationHash) ?? [];
  nomadLinkEstablishmentJobs.delete(destinationHash);
  for (const job of jobs) {
    clearNomadLinkEstablishmentTimers(job);
    emit({ type: 'nomadLinkResult', requestId: job.requestId, ok: true });
  }
}

function armNomadPathDiscoveryTimeout(job: NomadPageJob): void {
  clearNomadJobTimer(job);
  job.timer = setTimeout(
    () => failNomadJob(job, job.publicKey ? 'NOMAD_PATH_REQUEST_TIMEOUT' : 'NOMAD_DESTINATION_UNKNOWN'),
    pathRequestTimeoutMs,
  );
}

function clearNomadJobTimer(job: NomadPageJob): void {
  if (job.timer === undefined) return;
  clearTimeout(job.timer);
  job.timer = undefined;
}

function clearNomadDeadlineTimer(job: NomadPageJob): void {
  if (job.deadlineTimer === undefined) return;
  clearTimeout(job.deadlineTimer);
  job.deadlineTimer = undefined;
}

function clearNomadJobTimers(job: NomadPageJob): void {
  clearNomadJobTimer(job);
  clearNomadDeadlineTimer(job);
}

function armNomadPageDeadline(job: NomadPageJob, hops?: number): void {
  const deadlineAt = job.startedAt + nomadPageLoadDeadlineMs(hops);
  if (job.deadlineAt !== undefined && job.deadlineAt >= deadlineAt) return;
  clearNomadDeadlineTimer(job);
  job.deadlineAt = deadlineAt;
  job.deadlineTimer = setTimeout(
    () => handleNomadPageDeadline(job),
    Math.max(0, deadlineAt - Date.now()),
  );
  log('debug', 'wasm', 'NOMAD_PAGE_DEADLINE_ARMED', {
    destinationHash: job.destinationHash,
    path: job.path,
    ...(hops !== undefined ? { hops } : {}),
    timeoutMs: deadlineAt - job.startedAt,
  });
}

function handleNomadPageDeadline(job: NomadPageJob): void {
  const link = nomadLinksByDestination.get(job.destinationHash);
  failNomadJob(job, 'NOMAD_PAGE_LOAD_TIMEOUT');
  if (!link) return;
  if (!link.established && !nomadDestinationHasJobs(job.destinationHash)) {
    retireNomadLink(job.destinationHash, bytesToHex(link.linkId));
    return;
  }
  if (link.established && node) {
    try {
      processOutput(node.rejectResource(link.linkId) as WasmOutput);
    } catch {
      // No resource advertisement may be pending. The timed-out job is still
      // detached while the reusable established link remains cached.
    }
  }
}

function removeNomadJobFromQueues(job: NomadPageJob): void {
  for (const [destinationHash, jobs] of nomadPendingJobs) {
    const remaining = jobs.filter((item) => item !== job);
    if (remaining.length) nomadPendingJobs.set(destinationHash, remaining);
    else nomadPendingJobs.delete(destinationHash);
  }
  for (const [requestId, item] of nomadRequests) {
    if (item === job) nomadRequests.delete(requestId);
  }
}

function nomadDestinationHasJobs(destinationHash: string): boolean {
  if ((nomadPendingJobs.get(destinationHash)?.length ?? 0) > 0) return true;
  if ((nomadLinkEstablishmentJobs.get(destinationHash)?.length ?? 0) > 0) return true;
  return Array.from(nomadRequests.values()).some((job) => job.destinationHash === destinationHash);
}

function closeIdleNomadLink(destinationHash: string): void {
  const link = nomadLinksByDestination.get(destinationHash);
  if (!link || nomadDestinationHasJobs(destinationHash)) return;
  link.lastUsedAt = Date.now();
}

function sweepNomadLinks(): void {
  const now = Date.now();
  for (const link of Array.from(nomadLinksByDestination.values())) {
    if ((!link.established && !nomadDestinationHasJobs(link.destinationHash))
      || now - link.lastUsedAt > nomadLinkIdleTtlMs) {
      retireNomadLink(link.destinationHash, bytesToHex(link.linkId));
    }
  }
  while (nomadLinksByDestination.size >= maxCachedNomadLinks) {
    const oldest = Array.from(nomadLinksByDestination.values())
      .sort((left, right) => left.lastUsedAt - right.lastUsedAt)[0];
    if (!oldest) break;
    retireNomadLink(oldest.destinationHash, bytesToHex(oldest.linkId));
  }
}

function retireNomadLink(destinationHash: string, expectedLinkId?: string): void {
  const link = nomadLinksByDestination.get(destinationHash);
  if (!link) return;
  if (expectedLinkId && bytesToHex(link.linkId) !== expectedLinkId) return;
  nomadLinksByDestination.delete(destinationHash);
  nomadLinksById.delete(bytesToHex(link.linkId));
  emitNomadLinkStatus(destinationHash);
  try {
    processOutput(node?.closeLink(link.linkId) as WasmOutput | undefined);
  } catch {
    // The peer may already have discarded this link. Local eviction is the
    // important part; the replacement link uses fresh keys and a fresh ID.
  }
}

function recoverNomadJob(
  job: NomadPageJob,
  reason: string,
  failedLinkId = job.linkId,
  forcePathDiscovery = false,
): boolean {
  if (!node || job.recoveryAttempts >= maxNomadLinkRecoveryAttempts) return false;
  clearNomadJobTimer(job);
  removeNomadJobFromQueues(job);
  retireNomadLink(job.destinationHash, failedLinkId);
  job.recoveryAttempts += 1;

  const pending = nomadPendingJobs.get(job.destinationHash) ?? [];
  pending.push(job);
  nomadPendingJobs.set(job.destinationHash, pending);

  try {
    const destinationBytes = hexToBytes(job.destinationHash);
    if (forcePathDiscovery || !node.hasPath(destinationBytes)) {
      emitNomadPageProgress(job, 'findingPath');
      armNomadPathDiscoveryTimeout(job);
      processOutput(node.requestPath(destinationBytes) as WasmOutput);
      log('debug', 'wasm', 'RETICULUM_PATH_REQUESTED', {
        destinationHash: job.destinationHash,
        purpose: 'nomadPage',
        reason,
        recoveryAttempt: job.recoveryAttempts,
      });
    } else if (job.publicKey) {
      beginNomadLink(job.destinationHash, job.publicKey);
    }
    log('warning', 'wasm', 'NOMAD_LINK_RECOVERY_STARTED', {
      destinationHash: job.destinationHash,
      path: job.path,
      reason,
      attempt: job.recoveryAttempts,
    });
    return true;
  } catch {
    return false;
  }
}

function failNomadJob(job: NomadPageJob, code: string): void {
  clearNomadJobTimers(job);
  removeNomadJobFromQueues(job);
  closeIdleNomadLink(job.destinationHash);
  emit({ type: 'nomadPageFailed', requestId: job.requestId, code });
  log('warning', 'wasm', code, { destinationHash: job.destinationHash, path: job.path });
}

function failNomadDestination(destinationHash: string, code: string): void {
  const jobs = nomadPendingJobs.get(destinationHash) ?? [];
  nomadPendingJobs.delete(destinationHash);
  for (const job of jobs) failNomadJob(job, code);
}

function clearNomadState(code: string): void {
  const jobs = new Set<NomadPageJob>();
  for (const pending of nomadPendingJobs.values()) pending.forEach((job) => jobs.add(job));
  for (const job of nomadRequests.values()) jobs.add(job);
  const linkEstablishmentJobs = Array.from(nomadLinkEstablishmentJobs.values()).flat();
  nomadPendingJobs.clear();
  nomadRequests.clear();
  nomadLinkEstablishmentJobs.clear();
  const linkedDestinations = Array.from(nomadLinksByDestination.keys());
  nomadLinksByDestination.clear();
  nomadLinksById.clear();
  for (const destinationHash of linkedDestinations) emitNomadLinkStatus(destinationHash);
  for (const job of jobs) {
    clearNomadJobTimers(job);
    emit({ type: 'nomadPageFailed', requestId: job.requestId, code });
  }
  for (const job of linkEstablishmentJobs) {
    clearNomadLinkEstablishmentTimers(job);
    emit({ type: 'nomadLinkResult', requestId: job.requestId, ok: false, code });
  }
}

function requestProvisioning(command: Extract<RuntimeCommand, { type: 'requestProvisioning' }>): void {
  const destinationHash = normalizeDestinationHash(command.destinationHash);
  if (!node || !identity || !destinationHash || command.payload.byteLength === 0) {
    emit({ type: 'provisioningFailed', requestId: command.requestId, code: 'PROVISIONING_DESTINATION_UNKNOWN' });
    return;
  }
  const knownPublicKey = knownDestinationPublicKeys.get(destinationHash);
  closeOtherProvisioningDestinations(destinationHash);
  const job: ProvisioningJob = {
    requestId: command.requestId,
    destinationHash,
    publicKey: knownPublicKey ? bytesToHex(knownPublicKey) : undefined,
    payload: new Uint8Array(command.payload),
    safeToRetry: command.safeToRetry,
    responseTimeoutMs: command.responseTimeoutMs,
    recoveryAttempts: 0,
  };
  armProvisioningDeadline(job);
  const link = provisioningLinksByDestination.get(destinationHash);
  if (link?.established && link.identified) {
    sendProvisioningRequest(link, job);
    return;
  }
  const pending = provisioningPendingJobs.get(destinationHash) ?? [];
  pending.push(job);
  provisioningPendingJobs.set(destinationHash, pending);
  if (link) {
    emitProvisioningProgress(job, link.established ? 'identifying' : 'establishingLink');
    return;
  }
  try {
    const destinationBytes = hexToBytes(destinationHash);
    if (job.publicKey && node.hasPath(destinationBytes)) beginProvisioningLink(job);
    else {
      emitProvisioningProgress(job, 'findingPath');
      armProvisioningPathTimeout(job);
      processOutput(node.requestPath(destinationBytes) as WasmOutput);
      log('debug', 'wasm', 'RETICULUM_PATH_REQUESTED', {
        destinationHash,
        purpose: 'provisioning',
        recoveryAttempt: 0,
      });
    }
  } catch {
    failProvisioningDestination(destinationHash, 'PROVISIONING_PATH_REQUEST_FAILED');
  }
}

function beginProvisioningLink(job: ProvisioningJob): void {
  if (!node || !job.publicKey || provisioningLinksByDestination.has(job.destinationHash)) return;
  for (const pending of provisioningPendingJobs.get(job.destinationHash) ?? []) {
    clearProvisioningPathTimer(pending);
    emitProvisioningProgress(pending, 'establishingLink');
  }
  try {
    const result = connectReticulumDestination(job.destinationHash, job.publicKey);
    const link: ProvisioningLinkState = {
      destinationHash: job.destinationHash,
      linkId: new Uint8Array(result.linkId),
      established: false,
      everEstablished: false,
      identified: false,
    };
    provisioningLinksByDestination.set(link.destinationHash, link);
    provisioningLinksById.set(bytesToHex(link.linkId), link);
    processOutput(result.output);
    log('debug', 'wasm', 'PROVISIONING_LINK_ESTABLISHING', {
      destinationHash: link.destinationHash,
      linkId: bytesToHex(link.linkId),
    });
  } catch {
    failProvisioningDestination(job.destinationHash, 'PROVISIONING_LINK_FAILED');
  }
}

function sendProvisioningRequest(link: ProvisioningLinkState, job: ProvisioningJob): void {
  if (!node) return failProvisioningJob(job, 'PROVISIONING_RUNTIME_UNAVAILABLE');
  clearProvisioningPathTimer(job);
  try {
    const result = node.sendRequest(link.linkId, '/provision', job.payload, undefined) as {
      hash: Uint8Array;
      output: WasmOutput;
    };
    const requestHash = bytesToHex(new Uint8Array(result.hash));
    job.linkId = bytesToHex(link.linkId);
    provisioningRequests.set(requestHash, job);
    if (job.responseTimeoutMs !== undefined) {
      job.pathTimer = setTimeout(
        () => failProvisioningJob(job, 'PROVISIONING_REQUEST_TIMEOUT'),
        Math.max(1_000, Math.min(job.responseTimeoutMs, provisioningRequestDeadlineMs)),
      );
    }
    processOutput(result.output);
    emitProvisioningProgress(job, 'requesting');
    log('info', 'wasm', 'PROVISIONING_REQUEST_SENT', {
      destinationHash: job.destinationHash,
      linkId: job.linkId,
      requestHash,
      bytes: job.payload.byteLength,
      recoveryAttempt: job.recoveryAttempts,
    });
  } catch {
    failProvisioningJob(job, 'PROVISIONING_REQUEST_FAILED');
  }
}

function cancelProvisioning(destination: string, closeLink: boolean): void {
  const destinationHash = normalizeDestinationHash(destination);
  if (!destinationHash) return;
  const jobs = provisioningJobsForDestination(destinationHash);
  for (const job of jobs) failProvisioningJob(job, 'PROVISIONING_CANCELLED');
  const link = provisioningLinksByDestination.get(destinationHash);
  if (link && closeLink) retireProvisioningLink(destinationHash, bytesToHex(link.linkId));
  else if (link && node) {
    try { processOutput(node.rejectResource(link.linkId) as WasmOutput); } catch { /* no pending Resource */ }
  }
}

function provisioningDestinations(): Set<string> {
  return new Set([
    ...provisioningPendingJobs.keys(),
    ...provisioningLinksByDestination.keys(),
    ...Array.from(provisioningRequests.values(), (job) => job.destinationHash),
  ]);
}

function closeOtherProvisioningDestinations(activeDestinationHash: string): void {
  for (const destinationHash of provisioningDestinations()) {
    if (destinationHash === activeDestinationHash) continue;
    failProvisioningDestination(destinationHash, 'PROVISIONING_CANCELLED');
    retireProvisioningLink(destinationHash);
  }
}

function closeProvisioning(): void {
  for (const destinationHash of provisioningDestinations()) {
    failProvisioningDestination(destinationHash, 'PROVISIONING_CANCELLED');
    retireProvisioningLink(destinationHash);
  }
}

function emitProvisioningProgress(
  job: ProvisioningJob,
  stage: Extract<RuntimeEvent, { type: 'provisioningProgress' }>['stage'],
  details: { progress?: number; dataSize?: number } = {},
): void {
  emit({ type: 'provisioningProgress', requestId: job.requestId, stage, ...details });
}

function armProvisioningPathTimeout(job: ProvisioningJob): void {
  clearProvisioningPathTimer(job);
  job.pathTimer = setTimeout(
    () => failProvisioningJob(job, 'PROVISIONING_PATH_REQUEST_TIMEOUT'),
    pathRequestTimeoutMs,
  );
}

function armProvisioningDeadline(job: ProvisioningJob): void {
  job.deadlineTimer = setTimeout(() => {
    failProvisioningJob(job, 'PROVISIONING_REQUEST_TIMEOUT');
    const link = provisioningLinksByDestination.get(job.destinationHash);
    if (link && !provisioningDestinationHasJobs(job.destinationHash)) {
      retireProvisioningLink(job.destinationHash, bytesToHex(link.linkId));
    }
  }, provisioningRequestDeadlineMs);
}

function clearProvisioningPathTimer(job: ProvisioningJob): void {
  if (job.pathTimer === undefined) return;
  clearTimeout(job.pathTimer);
  job.pathTimer = undefined;
}

function clearProvisioningTimers(job: ProvisioningJob): void {
  clearProvisioningPathTimer(job);
  if (job.deadlineTimer !== undefined) clearTimeout(job.deadlineTimer);
  job.deadlineTimer = undefined;
}

function removeProvisioningJob(job: ProvisioningJob): void {
  for (const [destinationHash, jobs] of provisioningPendingJobs) {
    const remaining = jobs.filter((candidate) => candidate !== job);
    if (remaining.length) provisioningPendingJobs.set(destinationHash, remaining);
    else provisioningPendingJobs.delete(destinationHash);
  }
  for (const [requestHash, candidate] of provisioningRequests) {
    if (candidate === job) provisioningRequests.delete(requestHash);
  }
}

function provisioningJobsForDestination(destinationHash: string): Set<ProvisioningJob> {
  const jobs = new Set(provisioningPendingJobs.get(destinationHash) ?? []);
  for (const job of provisioningRequests.values()) if (job.destinationHash === destinationHash) jobs.add(job);
  return jobs;
}

function provisioningDestinationHasJobs(destinationHash: string): boolean {
  return provisioningJobsForDestination(destinationHash).size > 0;
}

function failProvisioningJob(job: ProvisioningJob, code: string): void {
  clearProvisioningTimers(job);
  removeProvisioningJob(job);
  emit({ type: 'provisioningFailed', requestId: job.requestId, code });
  log('warning', 'wasm', code, { destinationHash: job.destinationHash });
}

function failProvisioningDestination(destinationHash: string, code: string): void {
  for (const job of provisioningJobsForDestination(destinationHash)) failProvisioningJob(job, code);
}

function retireProvisioningLink(destinationHash: string, expectedLinkId?: string): void {
  const link = provisioningLinksByDestination.get(destinationHash);
  if (!link || (expectedLinkId && bytesToHex(link.linkId) !== expectedLinkId)) return;
  provisioningLinksByDestination.delete(destinationHash);
  provisioningLinksById.delete(bytesToHex(link.linkId));
  try { processOutput(node?.closeLink(link.linkId) as WasmOutput | undefined); } catch { /* already closed */ }
}

function recoverProvisioningJob(job: ProvisioningJob): boolean {
  if (!node || !job.safeToRetry || job.recoveryAttempts >= 1) return false;
  clearProvisioningPathTimer(job);
  removeProvisioningJob(job);
  retireProvisioningLink(job.destinationHash, job.linkId);
  job.recoveryAttempts += 1;
  const pending = provisioningPendingJobs.get(job.destinationHash) ?? [];
  pending.push(job);
  provisioningPendingJobs.set(job.destinationHash, pending);
  try {
    const destinationBytes = hexToBytes(job.destinationHash);
    emitProvisioningProgress(job, 'findingPath');
    armProvisioningPathTimeout(job);
    processOutput(node.requestPath(destinationBytes) as WasmOutput);
    log('warning', 'wasm', 'PROVISIONING_READ_RECOVERY_STARTED', {
      destinationHash: job.destinationHash,
      attempt: job.recoveryAttempts,
    });
    return true;
  } catch {
    return false;
  }
}

function clearProvisioningState(code: string): void {
  const jobs = new Set<ProvisioningJob>();
  for (const pending of provisioningPendingJobs.values()) pending.forEach((job) => jobs.add(job));
  for (const job of provisioningRequests.values()) jobs.add(job);
  provisioningPendingJobs.clear();
  provisioningRequests.clear();
  provisioningLinksByDestination.clear();
  provisioningLinksById.clear();
  for (const job of jobs) {
    clearProvisioningTimers(job);
    emit({ type: 'provisioningFailed', requestId: job.requestId, code });
  }
}

function scheduleAutomaticAnnounce(minimumDelayMs = 0): void {
  if (autoAnnounceTimer !== undefined) clearTimeout(autoAnnounceTimer);
  autoAnnounceTimer = undefined;
  const lxmf = configuration?.preferences.lxmf;
  if (!node || !lxmf?.autoAnnounceIntervalMinutes) return;
  const onlineDrivers = Array.from(drivers.values()).filter((driver) => driver.state === 'online');
  if (onlineDrivers.length === 0) return;
  const now = Date.now();
  const intervalMs = lxmf.autoAnnounceIntervalMinutes * 60_000;
  const nextDueAt = (identityLastAnnouncedAtMs(identity) ?? 0) + intervalMs;
  autoAnnounceTimer = setTimeout(() => {
    autoAnnounceTimer = undefined;
    announceIfBroadcastDue();
  }, Math.max(minimumDelayMs, nextDueAt - now, 0));
}

function announceIfBroadcastDue(): void {
  const lxmf = configuration?.preferences.lxmf;
  if (!node || !lxmf?.autoAnnounceIntervalMinutes) return;
  if (!identityAnnounceIsDue(identity, lxmf.autoAnnounceIntervalMinutes, Date.now())) {
    scheduleAutomaticAnnounce();
    return;
  }
  const announced = announceLxmf('automatic');
  scheduleAutomaticAnnounce(announced ? 0 : automaticAnnounceRetryDelayMs);
}

function scheduleAutomaticPropagationSync(): void {
  if (automaticPropagationSyncTimer !== undefined) clearTimeout(automaticPropagationSyncTimer);
  automaticPropagationSyncTimer = undefined;
  const lxmf = configuration?.preferences.lxmf;
  if (!node || !lxmf?.propagationSyncIntervalMinutes) return;
  automaticPropagationSyncTimer = setTimeout(() => {
    automaticPropagationSyncTimer = undefined;
    automaticPropagationSyncPending = !tryAutomaticPropagationSync();
    scheduleAutomaticPropagationSync();
  }, lxmf.propagationSyncIntervalMinutes * 60_000);
}

function tryAutomaticPropagationSync(): boolean {
  const lxmf = configuration?.preferences.lxmf;
  if (
    !node
    || !lxmf?.propagationSyncIntervalMinutes
    || propagationSyncRequestId
    || !Array.from(drivers.values()).some((driver) => driver.state === 'online')
  ) return false;
  syncLxmfPropagation(`automatic:${crypto.randomUUID()}`);
  return true;
}

function handleInterfaceOnline(driver: InterfaceDriver): void {
  const announceFingerprint = identity && configuration
    ? lxmfDeliveryAnnounceFingerprint(
        identity.displayName,
        configuration.preferences.lxmf.inboundStampCost,
      )
    : undefined;
  const deliveryHasCurrentAnnounce = localLxmfDeliveryDestinationHash && announceFingerprint
    ? destinationHasCurrentAnnounce(
        driver,
        localLxmfDeliveryDestinationHash,
        announceFingerprint,
      )
    : false;
  if (!deliveryHasCurrentAnnounce || driver.reannounceOnReconnect) {
    // All implicit announces were suppressed from the interface-up output.
    // Send only the metadata-complete LXMF delivery announce when this
    // destination or its metadata is new to the interface/network, or when
    // reconnect policy asks for another announce.
    announceLxmf('automatic', driver);
  }
  // Interface-online announcements do not move the regular broadcast
  // schedule. A due scheduled announce still reaches every online interface.
  announceIfBroadcastDue();
  if (automaticPropagationSyncPending && configuration?.preferences.lxmf.propagationSyncIntervalMinutes) {
    automaticPropagationSyncPending = !tryAutomaticPropagationSync();
    if (!automaticPropagationSyncPending) scheduleAutomaticPropagationSync();
  }
}

function handleWasmEvent(event: Record<string, unknown>): void {
  const linkId = eventBytes(event, 'linkId');
  if (linkId) {
    const linkIdHex = bytesToHex(linkId);
    if (event.type === 'linkEstablished' || event.type === 'linkRecovered') activeLinkIds.add(linkIdHex);
    if (event.type === 'linkStale' || event.type === 'linkClosed') activeLinkIds.delete(linkIdHex);
  }
  if (event.type === 'announceReceived') {
    const driver = driverForRuntimeId(eventNumber(event, 'interfaceIndex'));
    driver?.telemetry.recordIncomingAnnounce();
  }
  const pathEventCode = event.type === 'pathFound'
    ? 'RETICULUM_PATH_DISCOVERED'
    : event.type === 'pathRequestReceived'
      ? 'RETICULUM_PATH_REQUEST_RECEIVED'
      : event.type === 'pathLost'
        ? 'RETICULUM_PATH_LOST'
        : undefined;
  if (pathEventCode) {
    const destinationHash = eventBytes(event, 'destinationHash');
    const hops = eventNumber(event, 'hops');
    const interfaceId = stableInterfaceId(eventNumber(event, 'interfaceIndex'));
    log('debug', 'wasm', pathEventCode, {
      ...(destinationHash ? { destinationHash: bytesToHex(destinationHash) } : {}),
      ...(hops !== undefined ? { hops } : {}),
      ...(interfaceId ? { interfaceId } : {}),
    });
  }
  if (typeof event.type === 'string') {
    const linkId = eventBytes(event, 'linkId');
    const resourceHash = eventBytes(event, 'resourceHash');
    const messageId = eventBytes(event, 'messageId');
    const sourceHash = eventBytes(event, 'sourceHash');
    if (!pathEventCode) {
      const destinationHash = eventBytes(event, 'destinationHash');
      const hops = eventNumber(event, 'hops');
      const interfaceId = stableInterfaceId(eventNumber(event, 'interfaceIndex'));
      const state = eventString(event, 'state');
      const stateCode = eventNumber(event, 'code');
      log(event.type === 'lxmfInboundRejected' ? 'warning' : 'debug', 'wasm',
        `WASM_${event.type.replace(/([A-Z])/g, '_$1').toUpperCase()}`, {
        ...(linkId ? { linkId: bytesToHex(linkId) } : {}),
        ...(resourceHash ? { resourceHash: bytesToHex(resourceHash) } : {}),
        ...(messageId ? { messageId: bytesToHex(messageId) } : {}),
        ...(sourceHash ? { sourceHash: bytesToHex(sourceHash) } : {}),
        ...(destinationHash ? { destinationHash: bytesToHex(destinationHash) } : {}),
        ...(hops !== undefined ? { hops } : {}),
        ...(interfaceId ? { interfaceId } : {}),
        ...(state ? { state } : {}),
        ...(stateCode !== undefined ? { stateCode } : {}),
        ...(eventString(event, 'method') ? { method: eventString(event, 'method') } : {}),
        ...(eventString(event, 'reason') ? { reason: eventString(event, 'reason') } : {}),
        ...(eventNumber(event, 'dataSize') !== undefined ? { dataSize: eventNumber(event, 'dataSize') } : {}),
        ...(eventNumber(event, 'transferSize') !== undefined ? { transferSize: eventNumber(event, 'transferSize') } : {}),
        });
    }
  }
  if (event.type === 'pathFound') {
    const destinationHash = eventBytes(event, 'destinationHash');
    if (destinationHash) {
      emitDestinationPathStatus(destinationHash, true, eventNumber(event, 'hops'));
      const destinationHashHex = bytesToHex(destinationHash);
      resolveDestinationPathRequests(destinationHashHex, eventNumber(event, 'hops'));
      // Announce and path events can be part of the same WASM output. Defer
      // sending until every event has been projected so the public identity
      // needed to validate the full destination name is available.
      queueMicrotask(() => sendPendingProbes(destinationHashHex));
      queueMicrotask(emitKnownDestinationSnapshot);
    }
  }
  if (event.type === 'pathLost') {
    const destinationHash = eventBytes(event, 'destinationHash');
    if (destinationHash) emitDestinationPathStatus(destinationHash, false);
    queueMicrotask(emitKnownDestinationSnapshot);
  }
  if (event.type === 'resourceAdvertisementReceived') {
    handleNomadResourceAdvertisementEvent(event);
  }
  if (event.type === 'packetDeliveryConfirmed') handleProbeDeliveryConfirmed(event);
  if (event.type === 'deliveryFailed') handleProbeDeliveryFailed(event);
  handleChatTransferEvent(event);
  if (!identity) return;
  if (event.type === 'announceReceived') handleReceivedAnnounce(event);
  if (event.type === 'lxmfMessageReceived') handleReceivedLxmfMessage(event);
  if (event.type === 'lxmfMessageState') handleLxmfMessageState(event);
  if (event.type === 'lxmfStampPending') void generateDeliveryStamp(event);
  if (event.type === 'lxmfInboundStampPending') void validateInboundStamp(event);
  if (event.type === 'lxmfPropagationStampPending') void generatePropagationStamp(event);
  if (event.type === 'lxmfPropagationSyncState') handlePropagationSyncState(event);
  if (event.type === 'lxmfPropagationSyncComplete') handlePropagationSyncComplete(event);
  if (event.type === 'pathFound') handleNomadPathFound(event);
  if (event.type === 'pathFound') handleProvisioningPathFound(event);
  if (event.type === 'linkEstablished') handleNomadLinkEstablished(event);
  if (event.type === 'linkEstablished') handleProvisioningLinkEstablished(event);
  if (event.type === 'linkClosed') handleNomadLinkClosed(event);
  if (event.type === 'linkClosed') handleProvisioningLinkClosed(event);
  if (event.type === 'linkStale') handleNomadLinkStale(event);
  if (event.type === 'linkStale') handleProvisioningLinkStale(event);
  if (event.type === 'linkRecovered') handleNomadLinkRecovered(event);
  if (event.type === 'linkRecovered') handleProvisioningLinkRecovered(event);
  if (event.type === 'resourceAdvertised') handleNomadResourceAdvertised(event);
  if (event.type === 'resourceAdvertised') handleProvisioningResourceAdvertised(event);
  if (event.type === 'resourceTransferStarted' || event.type === 'resourceProgress') {
    handleNomadResourceProgress(event);
    handleProvisioningResourceProgress(event);
  }
  if (event.type === 'responseReceived') handleNomadResponse(event);
  if (event.type === 'responseReceived') handleProvisioningResponse(event);
  if (event.type === 'requestTimedOut') handleNomadRequestTimeout(event);
  if (event.type === 'requestTimedOut') handleProvisioningRequestTimeout(event);
}

function handleChatTransferEvent(event: Record<string, unknown>): void {
  const linkIdBytes = eventBytes(event, 'linkId');
  const linkId = linkIdBytes ? bytesToHex(linkIdBytes) : undefined;
  if (event.type === 'lxmfDirectLinkEstablished' && linkId) {
    const destinationHashBytes = eventBytes(event, 'destinationHash');
    if (destinationHashBytes) {
      const destinationHash = bytesToHex(destinationHashBytes);
      if (closeBlockedLxmfLink(linkId, destinationHash)) return;
      lxmfLinkDestinations.set(linkId, destinationHash);
      for (const [transferId, transfer] of inboundChatTransfers) {
        if (transfer.linkId !== linkId || transfer.destinationHash) continue;
        inboundChatTransfers.set(transferId, { ...transfer, destinationHash });
      }
    }
    lxmfDeliveryLinks.add(linkId);
    return;
  }
  if (event.type === 'linkClosed' && linkId) {
    lxmfDeliveryLinks.delete(linkId);
    lxmfLinkDestinations.delete(linkId);
    for (const [resourceId, advertisement] of pendingInboundResourceAdvertisements) {
      if (advertisement.linkId === linkId) pendingInboundResourceAdvertisements.delete(resourceId);
    }
    for (const [transferId, transfer] of inboundChatTransfers) {
      if (transfer.linkId === linkId) finishChatInboundTransfer(transferId, 'failed');
    }
    return;
  }
  if (!linkId || !lxmfDeliveryLinks.has(linkId)) return;
  const resourceHash = eventBytes(event, 'resourceHash');
  if (!resourceHash) return;
  const resourceId = bytesToHex(resourceHash);
  const isSender = eventBoolean(event, 'isSender');
  const disposition = classifyInboundResourceEvent(
    typeof event.type === 'string' ? event.type : '',
    isSender,
    inboundResourceSegments.has(resourceId),
  );

  if (isSender === true) {
    // A reflected UDP advertisement can be inspected before Core recognises
    // this node as the sender. Once the authoritative sender event arrives,
    // discard any staged copy so it can never become an inbound UI transfer.
    pendingInboundResourceAdvertisements.delete(resourceId);
    return;
  }

  if (disposition === 'stage') {
    const originalHash = eventBytes(event, 'originalHash');
    const transferId = originalHash ? bytesToHex(originalHash) : resourceId;
    const segmentIndex = Math.max(1, eventNumber(event, 'segmentIndex') ?? 1);
    const totalSegments = Math.max(segmentIndex, eventNumber(event, 'totalSegments') ?? 1);
    const dataSize = eventNumber(event, 'dataSize') ?? 0;
    const transferSize = eventNumber(event, 'transferSize');

    // This is a WASM-boundary inspection event emitted before Reticulum Core
    // filters and accepts the packet. UDP relays can reflect our own Resource
    // Advertisement, so retain its metadata but do not expose a receiving
    // transfer until Core confirms it with ResourceTransferStarted.
    if (pendingInboundResourceAdvertisements.size >= maxPendingInboundResourceAdvertisements) {
      const oldest = pendingInboundResourceAdvertisements.keys().next().value;
      if (oldest !== undefined) pendingInboundResourceAdvertisements.delete(oldest);
    }
    pendingInboundResourceAdvertisements.set(resourceId, {
      linkId,
      transferId,
      dataSize,
      transferSize,
      segmentIndex,
      totalSegments,
    });
    return;
  }

  if (disposition === 'start') {
    const advertisement = pendingInboundResourceAdvertisements.get(resourceId);
    pendingInboundResourceAdvertisements.delete(resourceId);
    const transferId = advertisement?.transferId ?? resourceId;
    const segmentIndex = advertisement?.segmentIndex ?? 1;
    const totalSegments = advertisement?.totalSegments ?? 1;
    inboundResourceSegments.set(resourceId, { transferId, segmentIndex, totalSegments });
    inboundChatTransfers.set(transferId, {
      linkId,
      destinationHash: lxmfLinkDestinations.get(linkId),
      dataSize: advertisement?.dataSize ?? 0,
      transferSize: advertisement?.transferSize,
      segmentIndex,
      totalSegments,
    });
    emitChatInboundTransfer(transferId, (segmentIndex - 1) / totalSegments);
    return;
  }

  // Progress/completion without an accepted inbound start belongs to an
  // outgoing or otherwise unrelated Resource and must not create a widget.
  if (disposition !== 'update') return;
  const segment = inboundResourceSegments.get(resourceId);
  if (!segment) return;
  const { transferId, segmentIndex, totalSegments } = segment;

  if (event.type === 'resourceProgress') {
    const existing = inboundChatTransfers.get(transferId);
    const dataSize = eventNumber(event, 'dataSize') ?? existing?.dataSize ?? 0;
    const transferSize = eventNumber(event, 'transferSize') ?? existing?.transferSize;
    const progress = Math.min(1, Math.max(0, eventNumber(event, 'progress') ?? 0));
    inboundChatTransfers.set(transferId, {
      linkId,
      destinationHash: existing?.destinationHash ?? lxmfLinkDestinations.get(linkId),
      dataSize,
      transferSize,
      segmentIndex,
      totalSegments,
    });
    emitChatInboundTransfer(transferId, ((segmentIndex - 1) + progress) / totalSegments);
    return;
  }

  if (event.type === 'resourceCompleted') {
    inboundResourceSegments.delete(resourceId);
    if (segmentIndex >= totalSegments) finishChatInboundTransfer(transferId, 'completed');
    else emitChatInboundTransfer(transferId, segmentIndex / totalSegments);
  }
  if (event.type === 'resourceFailed') finishChatInboundTransfer(transferId, 'failed');
}

function emitChatInboundTransfer(transferId: string, progress: number): void {
  const transfer = inboundChatTransfers.get(transferId);
  if (!transfer) return;
  emit({
    type: 'chatInboundTransfer',
    transferId,
    ...(transfer.destinationHash ? { destinationHash: transfer.destinationHash } : {}),
    state: 'receiving',
    progress: Math.min(1, Math.max(0, progress)),
    dataSize: transfer.dataSize,
    ...(transfer.transferSize !== undefined ? { transferSize: transfer.transferSize } : {}),
  });
}

function finishChatInboundTransfer(
  transferId: string,
  state: 'completed' | 'failed',
): void {
  const transfer = inboundChatTransfers.get(transferId);
  if (!transfer) return;
  inboundChatTransfers.delete(transferId);
  for (const [resourceId, segment] of inboundResourceSegments) {
    if (segment.transferId === transferId) inboundResourceSegments.delete(resourceId);
  }
  emit({
    type: 'chatInboundTransfer',
    transferId,
    ...(transfer.destinationHash ? { destinationHash: transfer.destinationHash } : {}),
    state,
    progress: state === 'completed' ? 1 : 0,
    dataSize: transfer.dataSize,
    ...(transfer.transferSize !== undefined ? { transferSize: transfer.transferSize } : {}),
  });
}

function handleNomadResourceAdvertisementEvent(event: Record<string, unknown>): void {
  const linkIdBytes = eventBytes(event, 'linkId');
  if (!linkIdBytes) return;
  const linkId = bytesToHex(linkIdBytes);
  if (!nomadLinksById.has(linkId)) return;

  const inspectionError = eventString(event, 'inspectionError');
  const advertisedRequestIdBytes = eventBytes(event, 'requestId');
  const advertisedRequestId = advertisedRequestIdBytes
    ? bytesToHex(advertisedRequestIdBytes)
    : undefined;
  const expectedRequestId = Array.from(nomadRequests.entries())
    .find(([, job]) => job.linkId === linkId)?.[0];
  log('debug', 'wasm', 'NOMAD_RESOURCE_ADVERTISEMENT_RECEIVED', {
    linkId,
    bytes: eventNumber(event, 'packetSize') ?? 0,
  });
  if (inspectionError) {
    log('warning', 'wasm', 'NOMAD_RESOURCE_ADVERTISEMENT_INSPECTION_FAILED', {
      linkId,
      message: inspectionError,
    });
    return;
  }
  log(
    advertisedRequestId && expectedRequestId && advertisedRequestId !== expectedRequestId
      ? 'warning'
      : 'debug',
    'wasm',
    'NOMAD_RESOURCE_ADVERTISEMENT_INSPECTED',
    {
      linkId,
      ...(advertisedRequestId ? { advertisedRequestId } : {}),
      ...(expectedRequestId ? { expectedRequestId } : {}),
      transferSize: eventNumber(event, 'transferSize') ?? 0,
      dataSize: eventNumber(event, 'dataSize') ?? 0,
      numParts: eventNumber(event, 'numParts') ?? 0,
      flags: eventNumber(event, 'flags') ?? 0,
    },
  );
}

function handlePropagationSyncState(event: Record<string, unknown>): void {
  const stateValue = eventString(event, 'state');
  if (!stateValue || !lxmfPropagationSyncStates.has(stateValue as LxmfPropagationSyncState)
    || !propagationSyncRequestId) return;
  const state = stateValue as LxmfPropagationSyncState;
  if (['noPath', 'linkFailed', 'transferFailed', 'noIdentity', 'noAccess', 'failed'].includes(state)) {
    finishPropagationSync(false, `LXMF_PROPAGATION_SYNC_${state.replace(/([A-Z])/g, '_$1').toUpperCase()}`);
    return;
  }
  const progressValue = eventNumber(event, 'progress');
  const progress = progressValue !== undefined && Number.isFinite(progressValue)
    ? progressValue
    : undefined;
  const transferSizeValue = eventNumber(event, 'transferSize');
  const transferSize = transferSizeValue !== undefined && Number.isFinite(transferSizeValue)
    ? transferSizeValue
    : undefined;
  emitPropagationSyncStatus({
    syncing: true,
    state,
    ...(progress !== undefined ? { progress: Math.min(1, Math.max(0, progress)) } : {}),
    ...(transferSize !== undefined ? { transferSize: Math.max(0, transferSize) } : {}),
  });
}

function handlePropagationSyncComplete(event: Record<string, unknown>): void {
  finishPropagationSync(
    true,
    undefined,
    eventNumber(event, 'received') ?? 0,
    eventNumber(event, 'duplicates') ?? 0,
  );
}

function handleNomadPathFound(event: Record<string, unknown>): void {
  const destinationHash = eventBytes(event, 'destinationHash');
  if (!destinationHash) return;
  const destinationHashHex = bytesToHex(destinationHash);
  const pending = nomadPendingJobs.get(destinationHashHex);
  const pendingLinkEstablishments = nomadLinkEstablishmentJobs.get(destinationHashHex);
  const hops = node?.hopsTo(destinationHash);
  for (const job of pending ?? []) armNomadPageDeadline(job, hops);
  for (const job of pendingLinkEstablishments ?? []) {
    armNomadLinkEstablishmentDeadline(job, hops);
  }
  const publicKey = pending?.[0]?.publicKey ?? pendingLinkEstablishments?.[0]?.publicKey;
  if (publicKey) beginNomadLink(destinationHashHex, publicKey);
}

function handleNomadLinkEstablished(event: Record<string, unknown>): void {
  const linkId = eventBytes(event, 'linkId');
  if (!linkId) return;
  const link = nomadLinksById.get(bytesToHex(linkId));
  if (!link) return;
  link.established = true;
  link.everEstablished = true;
  emitNomadLinkStatus(link.destinationHash);
  finishNomadLinkEstablishment(link.destinationHash);
  const jobs = nomadPendingJobs.get(link.destinationHash) ?? [];
  nomadPendingJobs.delete(link.destinationHash);
  for (const job of jobs) sendNomadRequest(link, job);
  log('info', 'wasm', 'NOMAD_LINK_ESTABLISHED', { destinationHash: link.destinationHash });
}

function handleNomadLinkStale(event: Record<string, unknown>): void {
  const linkId = eventBytes(event, 'linkId');
  if (!linkId) return;
  const link = nomadLinksById.get(bytesToHex(linkId));
  if (link) {
    link.established = false;
    emitNomadLinkStatus(link.destinationHash);
  }
}

function handleNomadLinkRecovered(event: Record<string, unknown>): void {
  const linkId = eventBytes(event, 'linkId');
  if (!linkId) return;
  const link = nomadLinksById.get(bytesToHex(linkId));
  if (!link) return;
  link.established = true;
  link.everEstablished = true;
  emitNomadLinkStatus(link.destinationHash);
  finishNomadLinkEstablishment(link.destinationHash);
  const jobs = nomadPendingJobs.get(link.destinationHash) ?? [];
  nomadPendingJobs.delete(link.destinationHash);
  for (const job of jobs) sendNomadRequest(link, job);
}

function handleNomadLinkClosed(event: Record<string, unknown>): void {
  const linkId = eventBytes(event, 'linkId');
  if (!linkId) return;
  const linkHex = bytesToHex(linkId);
  const link = nomadLinksById.get(linkHex);
  if (!link) return;
  const canRecover = link.everEstablished;
  nomadLinksById.delete(linkHex);
  nomadLinksByDestination.delete(link.destinationHash);
  emitNomadLinkStatus(link.destinationHash);
  failNomadLinkEstablishmentDestination(
    link.destinationHash,
    canRecover ? 'NOMAD_LINK_CLOSED' : 'NOMAD_LINK_ESTABLISHMENT_FAILED',
  );
  const affectedJobs = new Set(nomadPendingJobs.get(link.destinationHash) ?? []);
  nomadPendingJobs.delete(link.destinationHash);
  for (const [requestId, job] of Array.from(nomadRequests.entries())) {
    if (job.destinationHash === link.destinationHash) {
      nomadRequests.delete(requestId);
      affectedJobs.add(job);
    }
  }
  for (const job of affectedJobs) {
    const reason = canRecover ? 'NOMAD_LINK_CLOSED' : 'NOMAD_LINK_ESTABLISHMENT_FAILED';
    // NodeCore retries the handshake with fresh keys before reporting a
    // timeout. On final establishment failure it expires the cached path and
    // starts discovery before emitting LinkClosed. Keep the page job alive,
    // reinforce that path request (it is rate-limited in the core), and only
    // reconnect after PathFound instead of immediately reusing a stale route.
    if (recoverNomadJob(job, reason, linkHex, !canRecover)) continue;
    failNomadJob(job, canRecover ? 'NOMAD_LINK_CLOSED' : 'NOMAD_LINK_ESTABLISHMENT_FAILED');
  }
}

function handleNomadResourceAdvertised(event: Record<string, unknown>): void {
  const linkId = eventBytes(event, 'linkId');
  if (!node || !linkId || !nomadLinksById.has(bytesToHex(linkId))) return;
  const dataSize = eventNumber(event, 'dataSize') ?? 0;
  const link = nomadLinksById.get(bytesToHex(linkId));
  const hasActiveRequest = Boolean(link && Array.from(nomadRequests.values()).some((job) => (
    job.destinationHash === link.destinationHash
  )));
  if (link && !hasActiveRequest) {
    try {
      processOutput(node.rejectResource(linkId) as WasmOutput);
    } catch {
      // A core-managed strategy may already have consumed the advertisement.
    }
    log('debug', 'wasm', 'NOMAD_RESOURCE_ADVERTISEMENT_REJECTED_NO_REQUEST', {
      linkId: bytesToHex(linkId),
      dataSize,
    });
    return;
  }
  if (link) {
    for (const job of nomadRequests.values()) {
      if (job.destinationHash === link.destinationHash) {
        emitNomadPageProgress(job, 'receivingPage', { progress: 0, dataSize });
      }
    }
  }
  log('debug', 'wasm', 'NOMAD_RESOURCE_ADVERTISEMENT_ACCEPTING', {
    linkId: bytesToHex(linkId),
    dataSize,
  });
  try {
    processOutput(dataSize <= maxNomadPageBytes
      ? node.acceptResource(linkId) as WasmOutput
      : node.rejectResource(linkId) as WasmOutput);
    if (dataSize > maxNomadPageBytes && link) {
      for (const job of Array.from(nomadRequests.values())) {
        if (job.destinationHash === link.destinationHash) failNomadJob(job, 'NOMAD_PAGE_TOO_LARGE');
      }
    }
  } catch {
    if (link) {
      failNomadDestination(link.destinationHash, 'NOMAD_RESOURCE_FAILED');
      for (const job of Array.from(nomadRequests.values())) {
        if (job.destinationHash === link.destinationHash) failNomadJob(job, 'NOMAD_RESOURCE_FAILED');
      }
    }
  }
}

function handleNomadResourceProgress(event: Record<string, unknown>): void {
  const linkId = eventBytes(event, 'linkId');
  if (!linkId) return;
  const link = nomadLinksById.get(bytesToHex(linkId));
  if (!link) return;
  const rawProgress = eventNumber(event, 'progress');
  const progress = rawProgress === undefined ? undefined : Math.min(1, Math.max(0, rawProgress));
  const dataSize = eventNumber(event, 'dataSize');
  for (const job of nomadRequests.values()) {
    if (job.destinationHash === link.destinationHash) {
      emitNomadPageProgress(job, 'receivingPage', { progress, dataSize });
    }
  }
}

function handleNomadResponse(event: Record<string, unknown>): void {
  const requestId = eventBytes(event, 'requestId');
  const responseData = eventBytes(event, 'responseData');
  if (!requestId || !responseData) return;
  const requestHex = bytesToHex(requestId);
  const job = nomadRequests.get(requestHex);
  if (!job) return;
  nomadRequests.delete(requestHex);
  if (responseData.byteLength > maxNomadPageBytes) return failNomadJob(job, 'NOMAD_PAGE_TOO_LARGE');
  const pageData = unpackNomadPageResponse(responseData);
  if (!pageData) return failNomadJob(job, 'NOMAD_PAGE_RESPONSE_INVALID');
  if (pageData.byteLength > maxNomadPageBytes) return failNomadJob(job, 'NOMAD_PAGE_TOO_LARGE');
  try {
    // Match MeshChatX/Python: preserve the page and replace malformed UTF-8
    // sequences instead of rejecting an otherwise valid NomadNet response.
    const content = new TextDecoder('utf-8').decode(pageData);
    clearNomadJobTimers(job);
    emit({
      type: 'nomadPageLoaded',
      requestId: job.requestId,
      destinationHash: job.destinationHash,
      path: job.path,
      requestData: job.requestData,
      content,
      receivedAt: new Date().toISOString(),
    });
    log('info', 'wasm', 'NOMAD_PAGE_RECEIVED', {
      destinationHash: job.destinationHash,
      path: job.path,
      bytes: pageData.byteLength,
    });
    closeIdleNomadLink(job.destinationHash);
  } catch {
    failNomadJob(job, 'NOMAD_PAGE_INVALID_UTF8');
  }
}

function handleNomadRequestTimeout(event: Record<string, unknown>): void {
  const requestId = eventBytes(event, 'requestId');
  if (!requestId) return;
  const job = nomadRequests.get(bytesToHex(requestId));
  if (!job) return;
  nomadRequests.delete(bytesToHex(requestId));
  failNomadJob(job, 'NOMAD_REQUEST_TIMEOUT');
}

function handleProvisioningPathFound(event: Record<string, unknown>): void {
  const destinationHash = eventBytes(event, 'destinationHash');
  if (!destinationHash) return;
  const pending = provisioningPendingJobs.get(bytesToHex(destinationHash));
  if (pending?.[0]?.publicKey) beginProvisioningLink(pending[0]);
}

function handleProvisioningLinkEstablished(event: Record<string, unknown>): void {
  const linkId = eventBytes(event, 'linkId');
  if (!node || !linkId) return;
  const link = provisioningLinksById.get(bytesToHex(linkId));
  if (!link) return;
  link.established = true;
  link.everEstablished = true;
  const jobs = provisioningPendingJobs.get(link.destinationHash) ?? [];
  for (const job of jobs) emitProvisioningProgress(job, 'identifying');
  try {
    processOutput(node.identifyLink(link.linkId) as WasmOutput);
    link.identified = true;
  } catch {
    for (const job of jobs) failProvisioningJob(job, 'PROVISIONING_IDENTIFY_FAILED');
    retireProvisioningLink(link.destinationHash, bytesToHex(link.linkId));
    return;
  }
  provisioningPendingJobs.delete(link.destinationHash);
  for (const job of jobs) sendProvisioningRequest(link, job);
  log('info', 'wasm', 'PROVISIONING_LINK_ESTABLISHED', {
    destinationHash: link.destinationHash,
    linkId: bytesToHex(link.linkId),
  });
}

function handleProvisioningLinkStale(event: Record<string, unknown>): void {
  const linkId = eventBytes(event, 'linkId');
  if (!linkId) return;
  const link = provisioningLinksById.get(bytesToHex(linkId));
  if (link) link.established = false;
}

function handleProvisioningLinkRecovered(event: Record<string, unknown>): void {
  const linkId = eventBytes(event, 'linkId');
  if (!linkId) return;
  const link = provisioningLinksById.get(bytesToHex(linkId));
  if (!link) return;
  link.established = true;
  link.everEstablished = true;
}

function handleProvisioningLinkClosed(event: Record<string, unknown>): void {
  const linkId = eventBytes(event, 'linkId');
  if (!linkId) return;
  const linkHex = bytesToHex(linkId);
  const link = provisioningLinksById.get(linkHex);
  if (!link) return;
  provisioningLinksById.delete(linkHex);
  provisioningLinksByDestination.delete(link.destinationHash);
  const jobs = provisioningJobsForDestination(link.destinationHash);
  provisioningPendingJobs.delete(link.destinationHash);
  for (const job of jobs) {
    removeProvisioningJob(job);
    if (link.everEstablished && recoverProvisioningJob(job)) continue;
    failProvisioningJob(job, link.everEstablished ? 'PROVISIONING_LINK_CLOSED' : 'PROVISIONING_LINK_ESTABLISHMENT_FAILED');
  }
}

function handleProvisioningResourceAdvertised(event: Record<string, unknown>): void {
  const linkId = eventBytes(event, 'linkId');
  if (!node || !linkId) return;
  const link = provisioningLinksById.get(bytesToHex(linkId));
  if (!link) return;
  const jobs = Array.from(provisioningRequests.values()).filter((job) => job.destinationHash === link.destinationHash);
  const dataSize = eventNumber(event, 'dataSize') ?? 0;
  if (jobs.length === 0 || dataSize > maxProvisioningResponseBytes) {
    try { processOutput(node.rejectResource(linkId) as WasmOutput); } catch { /* already handled */ }
    if (dataSize > maxProvisioningResponseBytes) {
      for (const job of jobs) failProvisioningJob(job, 'PROVISIONING_RESPONSE_TOO_LARGE');
    }
    return;
  }
  for (const job of jobs) emitProvisioningProgress(job, 'receiving', { progress: 0, dataSize });
  try {
    processOutput(node.acceptResource(linkId) as WasmOutput);
  } catch {
    for (const job of jobs) failProvisioningJob(job, 'PROVISIONING_RESOURCE_FAILED');
  }
}

function handleProvisioningResourceProgress(event: Record<string, unknown>): void {
  const linkId = eventBytes(event, 'linkId');
  if (!linkId) return;
  const link = provisioningLinksById.get(bytesToHex(linkId));
  if (!link) return;
  const progress = eventNumber(event, 'progress');
  const dataSize = eventNumber(event, 'dataSize');
  for (const job of provisioningRequests.values()) {
    if (job.destinationHash !== link.destinationHash) continue;
    emitProvisioningProgress(job, 'receiving', {
      ...(progress === undefined ? {} : { progress: Math.min(1, Math.max(0, progress)) }),
      ...(dataSize === undefined ? {} : { dataSize }),
    });
  }
}

function handleProvisioningResponse(event: Record<string, unknown>): void {
  const requestId = eventBytes(event, 'requestId');
  const responseData = eventBytes(event, 'responseData');
  if (!requestId || !responseData) return;
  const requestHash = bytesToHex(requestId);
  const job = provisioningRequests.get(requestHash);
  if (!job) return;
  provisioningRequests.delete(requestHash);
  if (responseData.byteLength > maxProvisioningResponseBytes) {
    failProvisioningJob(job, 'PROVISIONING_RESPONSE_TOO_LARGE');
    return;
  }
  clearProvisioningTimers(job);
  removeProvisioningJob(job);
  emit({ type: 'provisioningResponse', requestId: job.requestId, data: new Uint8Array(responseData) });
  log('info', 'wasm', 'PROVISIONING_RESPONSE_RECEIVED', {
    destinationHash: job.destinationHash,
    bytes: responseData.byteLength,
  });
}

function handleProvisioningRequestTimeout(event: Record<string, unknown>): void {
  const requestId = eventBytes(event, 'requestId');
  if (!requestId) return;
  const job = provisioningRequests.get(bytesToHex(requestId));
  if (!job) return;
  provisioningRequests.delete(bytesToHex(requestId));
  failProvisioningJob(job, 'PROVISIONING_REQUEST_TIMEOUT');
}

function handleLxmfMessageState(event: Record<string, unknown>): void {
  if (!identity) return;
  const messageId = eventBytes(event, 'messageId');
  const state = eventString(event, 'state');
  if (!messageId || !state) return;
  emit({ type: 'chatMessageState', identityId: identity.id, messageId: bytesToHex(messageId), state });
}

async function generateDeliveryStamp(event: Record<string, unknown>): Promise<void> {
  const messageId = eventBytes(event, 'messageId');
  const targetCost = eventNumber(event, 'targetCost');
  const currentNode = node;
  if (!messageId || targetCost === undefined || !currentNode) return;
  const messageIdHex = bytesToHex(messageId);
  await stampWork.run(`delivery:${messageIdHex}:${targetCost}`, async () => {
    let stamp: Uint8Array;
    try {
      stamp = await ReticulumNode.generateLxmfStamp(messageId, targetCost, 8);
    } catch (error) {
      log('error', 'wasm', 'LXMF_STAMP_GENERATION_FAILED', {
        messageId: messageIdHex,
        targetCost,
        message: diagnosticErrorMessage(error),
      });
      return;
    }
    if (node !== currentNode) return;
    try {
      processOutput(currentNode.setLxmfOutboundStampResult(messageId, targetCost, stamp) as WasmOutput);
    } catch (error) {
      logStampResultError('LXMF_STAMP', error, { messageId: messageIdHex, targetCost });
    }
  });
}

async function validateInboundStamp(event: Record<string, unknown>): Promise<void> {
  const messageId = eventBytes(event, 'messageId');
  const stamp = eventBytes(event, 'stamp');
  const targetCost = eventNumber(event, 'targetCost');
  const currentNode = node;
  if (!messageId || !stamp || targetCost === undefined || !currentNode) return;
  const messageIdHex = bytesToHex(messageId);
  const key = `inbound:${messageIdHex}:${bytesToHex(stamp)}:${targetCost}`;
  await stampWork.run(key, async () => {
    let valid: boolean;
    try {
      valid = await ReticulumNode.validateLxmfStamp(messageId, stamp, targetCost, 8);
    } catch (error) {
      log('error', 'wasm', 'LXMF_INBOUND_STAMP_VALIDATION_FAILED', {
        messageId: messageIdHex,
        targetCost,
        message: diagnosticErrorMessage(error),
      });
      return;
    }
    if (node !== currentNode) return;
    try {
      processOutput(currentNode.setLxmfInboundStampResult(messageId, stamp, targetCost, valid) as WasmOutput);
    } catch (error) {
      logStampResultError('LXMF_INBOUND_STAMP', error, { messageId: messageIdHex, targetCost });
    }
  });
}

async function generatePropagationStamp(event: Record<string, unknown>): Promise<void> {
  const messageId = eventBytes(event, 'messageId');
  const transientId = eventBytes(event, 'transientId');
  const targetCost = eventNumber(event, 'targetCost');
  const currentNode = node;
  if (!messageId || !transientId || targetCost === undefined || !currentNode) return;
  const messageIdHex = bytesToHex(messageId);
  const key = `propagation:${messageIdHex}:${bytesToHex(transientId)}:${targetCost}`;
  await stampWork.run(key, async () => {
    let stamp: Uint8Array;
    try {
      stamp = await ReticulumNode.generateLxmfPropagationStamp(transientId, targetCost, 8);
    } catch (error) {
      log('error', 'wasm', 'LXMF_PROPAGATION_STAMP_GENERATION_FAILED', {
        messageId: messageIdHex,
        targetCost,
        message: diagnosticErrorMessage(error),
      });
      return;
    }
    if (node !== currentNode) return;
    try {
      processOutput(currentNode.setLxmfOutboundPropagationStampResult(
        messageId,
        transientId,
        targetCost,
        stamp,
      ) as WasmOutput);
    } catch (error) {
      logStampResultError('LXMF_PROPAGATION_STAMP', error, { messageId: messageIdHex, targetCost });
    }
  });
}

function logStampResultError(
  prefix: 'LXMF_STAMP' | 'LXMF_INBOUND_STAMP' | 'LXMF_PROPAGATION_STAMP',
  error: unknown,
  details: { messageId: string; targetCost: number },
): void {
  const message = diagnosticErrorMessage(error);
  if (message === 'StaleStampRequest') {
    log('debug', 'wasm', `${prefix}_RESULT_STALE`, details);
    return;
  }
  log('error', 'wasm', `${prefix}_RESULT_FAILED`, { ...details, message });
}

function handleReceivedAnnounce(event: Record<string, unknown>): void {
  if (!identity) return;
  const announce = (event.announce && typeof event.announce === 'object' ? event.announce : event) as Record<string, unknown>;
  const nameHash = eventBytes(announce, 'nameHash');
  const destinationHash = eventBytes(announce, 'destinationHash');
  const appData = eventBytes(announce, 'appData');
  const publicKey = eventBytes(announce, 'publicKey');
  if (!nameHash || !destinationHash) {
    log('warning', 'wasm', 'RETICULUM_ANNOUNCE_PROJECTION_INVALID');
    return;
  }
  if (publicKey?.byteLength === 64) {
    knownDestinationPublicKeys.set(bytesToHex(destinationHash), new Uint8Array(publicKey));
    emitKnownDestinationSnapshot();
  }
  const pathHops = node?.hopsTo(destinationHash);
  const hops = typeof pathHops === 'number' && Number.isSafeInteger(pathHops) && pathHops >= 0
    ? pathHops
    : undefined;
  const heardAt = new Date().toISOString();
  const destinationHashHex = bytesToHex(destinationHash);
  emitDestinationPathStatus(destinationHash, hops !== undefined, hops);

  if (managementNodeNameHash && equalBytes(nameHash, managementNodeNameHash)
    && publicKey?.byteLength === 64) {
    const publicKeyHex = bytesToHex(publicKey);
    emit({
      type: 'knownDestinationObserved',
      destinationHash: destinationHashHex,
      fullDestinationName: 'rnstransport.remote.management',
      lastAnnouncedAt: heardAt,
      metadata: {},
    });
    log('debug', 'wasm', 'PROVISIONING_MANAGEMENT_ANNOUNCE_PROJECTED', {
      destinationHash: destinationHashHex,
    });
    const pending = provisioningPendingJobs.get(destinationHashHex) ?? [];
    if (pending.length) {
      for (const job of pending) job.publicKey = publicKeyHex;
      if (node?.hasPath(destinationHash)) beginProvisioningLink(pending[0]);
    }
    return;
  }

  if (nomadNodeNameHash && equalBytes(nameHash, nomadNodeNameHash)) {
    const publicKeyHex = publicKey?.byteLength === 64 ? bytesToHex(publicKey) : undefined;
    const decodedAppData = decodeNomadNodeAppData(appData);
    emit({
      type: 'knownDestinationObserved',
      destinationHash: destinationHashHex,
      fullDestinationName: 'nomadnetwork.node',
      // The NomadNet node name is both this destination's display name and
      // the identity-level shared-name source used by the directory manager.
      displayName: decodedAppData.sharedDisplayName,
      lastAnnouncedAt: heardAt,
      metadata: {},
    });
    const pending = nomadPendingJobs.get(destinationHashHex) ?? [];
    const pendingLinkEstablishments = nomadLinkEstablishmentJobs.get(destinationHashHex) ?? [];
    if (publicKeyHex && (pending.length || pendingLinkEstablishments.length)) {
      for (const job of pending) job.publicKey = publicKeyHex;
      for (const job of pendingLinkEstablishments) job.publicKey = publicKeyHex;
      if (node?.hasPath(destinationHash)) {
        beginNomadLink(destinationHashHex, publicKeyHex);
      }
    }
    return;
  }

  if (appData) {
    try {
      const propagation = ReticulumNode.parseLxmfPropagationAnnounce(nameHash, appData) as {
        enabled?: unknown;
        transferLimitKb?: unknown;
        syncLimitKb?: unknown;
        stampCost?: unknown;
        peeringCost?: unknown;
      } | undefined;
      if (propagation) {
        emit({
          type: 'knownDestinationObserved',
          destinationHash: destinationHashHex,
          fullDestinationName: 'lxmf.propagation',
          lastAnnouncedAt: heardAt,
          metadata: {
            enabled: propagation.enabled === true,
            transferLimitKb: typeof propagation.transferLimitKb === 'number' ? propagation.transferLimitKb : 0,
            syncLimitKb: typeof propagation.syncLimitKb === 'number' ? propagation.syncLimitKb : 0,
            stampCost: typeof propagation.stampCost === 'number' ? propagation.stampCost : 0,
            peeringCost: typeof propagation.peeringCost === 'number' ? propagation.peeringCost : 0,
          },
        });
        log('debug', 'wasm', 'LXMF_PROPAGATION_ANNOUNCE_PROJECTED', {
          destinationHash: bytesToHex(destinationHash),
        });
        return;
      }
    } catch (error) {
      emit({
        type: 'knownDestinationObserved',
        destinationHash: destinationHashHex,
        fullDestinationName: 'lxmf.propagation',
        lastAnnouncedAt: heardAt,
      });
      log('warning', 'wasm', 'LXMF_PROPAGATION_ANNOUNCE_PARSE_FAILED', {
        destinationHash: bytesToHex(destinationHash),
        appDataBytes: appData.byteLength,
        message: diagnosticErrorMessage(error),
      });
      return;
    }
  }

  if (!appData || !publicKey || publicKey.byteLength !== 64) {
    emit({
      type: 'knownDestinationObserved',
      destinationHash: destinationHashHex,
      lastAnnouncedAt: heardAt,
    });
    log('debug', 'wasm', 'RETICULUM_ANNOUNCE_IGNORED_INCOMPLETE', {
      destinationHash: destinationHashHex,
      appDataBytes: appData?.byteLength ?? 0,
      publicKeyBytes: publicKey?.byteLength ?? 0,
    });
    return;
  }
  try {
    const decoded = ReticulumNode.parseLxmfDeliveryAnnounce(nameHash, appData) as {
      displayName?: unknown;
      stampCost?: unknown;
      compressionSupported?: unknown;
    } | undefined;
    if (!decoded) {
      emit({
        type: 'knownDestinationObserved',
        destinationHash: destinationHashHex,
        lastAnnouncedAt: heardAt,
      });
      log('debug', 'wasm', 'RETICULUM_ANNOUNCE_IGNORED_NOT_LXMF', {
        destinationHash: destinationHashHex,
        nameHash: bytesToHex(nameHash),
      });
      return;
    }
    log('debug', 'wasm', 'LXMF_ANNOUNCE_PROJECTED', {
      destinationHash: bytesToHex(destinationHash),
    });
    emit({
      type: 'knownDestinationObserved',
      destinationHash: destinationHashHex,
      fullDestinationName: 'lxmf.delivery',
      displayName: typeof decoded.displayName === 'string' && decoded.displayName.trim()
        ? decoded.displayName.trim().slice(0, 256)
        : undefined,
      lastAnnouncedAt: heardAt,
      metadata: {
        ...(typeof decoded.stampCost === 'number' ? { stampCost: decoded.stampCost } : {}),
        ...(typeof decoded.compressionSupported === 'boolean'
          ? { compressionSupported: decoded.compressionSupported }
          : {}),
      },
    });
  } catch {
    emit({
      type: 'knownDestinationObserved',
      destinationHash: destinationHashHex,
      fullDestinationName: 'lxmf.delivery',
      lastAnnouncedAt: heardAt,
    });
    log('warning', 'wasm', 'LXMF_ANNOUNCE_PARSE_FAILED', { destinationHash: bytesToHex(destinationHash) });
  }
}

function emitDestinationPathStatus(
  destinationHash: Uint8Array,
  hasPath: boolean,
  hops?: number,
): void {
  const destinationHashHex = bytesToHex(destinationHash);
  destinationPathStatusCache.set(destinationHashHex, pathStatusSignature(hasPath, hops));
  emit({
    type: 'destinationPathStatuses',
    statuses: [{
      destinationHash: destinationHashHex,
      hasPath,
      ...(hasPath && hops !== undefined ? { hops } : {}),
    }],
  });
}

function emitDestinationPathStatuses(destinations: string[], force = true): void {
  if (!node) return;
  const normalizedDestinations = Array.from(new Set(
    destinations.map(normalizeDestinationHash).filter((value): value is string => Boolean(value)),
  ));
  for (const destinationHash of normalizedDestinations) observedDestinationPaths.add(destinationHash);
  const statuses = normalizedDestinations.flatMap((destinationHash) => {
    let hasPath = false;
    let hops: number | undefined;
    try {
      const destinationBytes = hexToBytes(destinationHash);
      hasPath = node?.hasPath(destinationBytes) === true;
      const currentHops = hasPath ? node?.hopsTo(destinationBytes) : undefined;
      hops = typeof currentHops === 'number' ? currentHops : undefined;
    } catch {
      hasPath = false;
    }
    const signature = pathStatusSignature(hasPath, hops);
    if (!force && destinationPathStatusCache.get(destinationHash) === signature) return [];
    destinationPathStatusCache.set(destinationHash, signature);
    return [{
      destinationHash,
      hasPath,
      ...(hops !== undefined ? { hops } : {}),
    }];
  });
  if (statuses.length) emit({ type: 'destinationPathStatuses', statuses });
}

function pathStatusSignature(hasPath: boolean, hops?: number): string {
  return hasPath ? `known:${hops ?? 'unknown'}` : 'unknown';
}

function handleReceivedLxmfMessage(event: Record<string, unknown>): void {
  if (!identity) return;
  const messageId = eventBytes(event, 'messageId');
  const sourceHash = eventBytes(event, 'sourceHash');
  const destinationHash = eventBytes(event, 'destinationHash');
  const title = eventBytes(event, 'title');
  const content = eventBytes(event, 'content');
  if (!messageId || !sourceHash || !destinationHash || !title || !content) {
    log('warning', 'wasm', 'LXMF_MESSAGE_PROJECTION_INVALID');
    return;
  }
  const sourceHashHex = bytesToHex(sourceHash);
  if (configuration && !lxmfInboundSourceAllowed(
    configuration.preferences.lxmf,
    sourceHashHex,
    contactDestinationHashes,
  )) {
    log('info', 'runtime', 'LXMF_MESSAGE_IGNORED_NOT_CONTACT', {
      messageId: bytesToHex(messageId),
      sourceHash: sourceHashHex,
    });
    return;
  }
  emit({
    type: 'chatMessageReceived',
    identityId: identity.id,
    messageId: bytesToHex(messageId),
    sourceHash: sourceHashHex,
    destinationHash: bytesToHex(destinationHash),
    title: new TextDecoder().decode(title),
    content: new TextDecoder().decode(content),
    attachments: eventChatAttachments(event),
    method: eventString(event, 'method'),
    verification: eventString(event, 'verification'),
    stamp: inboundChatMessageStamp({
      requiredCost: configuration?.preferences.lxmf.inboundStampCost ?? 0,
      stampLength: eventBytes(event, 'stamp')?.byteLength,
      verification: eventString(event, 'verification'),
    }),
    path: currentChatMessagePath(sourceHashHex),
    timestamp: eventNumber(event, 'timestamp'),
    receivedAt: new Date().toISOString(),
  });
  log('debug', 'wasm', 'LXMF_MESSAGE_PROJECTED', { messageId: bytesToHex(messageId) });
}

function eventChatAttachments(event: Record<string, unknown>): ChatAttachment[] {
  const raw = event.attachments;
  if (!raw || typeof raw !== 'object') return [];
  const value = raw as Record<string, unknown>;
  const attachments: ChatAttachment[] = [];
  if (Array.isArray(value.files)) {
    for (const entry of value.files) {
      if (!entry || typeof entry !== 'object') continue;
      const file = entry as Record<string, unknown>;
      const data = attachmentBytes(file.data);
      if (!data) continue;
      const name = safeAttachmentName(typeof file.name === 'string' ? file.name : '', 'attachment.bin');
      const mimeType = inferAttachmentMimeType(name);
      const kind: ChatAttachment['kind'] = mimeType.startsWith('audio/')
        ? 'audio' : mimeType.startsWith('image/') ? 'image' : 'file';
      attachments.push({ kind, name, mimeType, data });
    }
  }
  if (value.image && typeof value.image === 'object') {
    const image = value.image as Record<string, unknown>;
    const data = attachmentBytes(image.data);
    const format = typeof image.format === 'string' ? image.format : 'image';
    if (data) {
      const mimeType = imageMime(format);
      const extension = mimeType === 'image/jpeg' ? 'jpg' : mimeType.replace(/^image\//, '');
      attachments.push({ kind: 'image', name: `image.${extension}`, mimeType, data });
    }
  }
  if (value.audio && typeof value.audio === 'object') {
    const audio = value.audio as Record<string, unknown>;
    const data = attachmentBytes(audio.data);
    const mode = typeof audio.mode === 'string' ? audio.mode : '';
    if (data) attachments.push({
      kind: mode === 'custom' ? 'audio' : 'file',
      name: mode === 'custom' ? 'voice-message.webm' : `audio-${mode || 'unknown'}.bin`,
      mimeType: mode === 'custom' ? 'audio/webm' : 'application/octet-stream',
      data,
    });
  }
  try {
    return normalizeChatAttachments(attachments);
  } catch {
    return [];
  }
}

function attachmentBytes(value: unknown): Uint8Array | undefined {
  if (value instanceof Uint8Array) return value;
  try {
    return value === undefined || value === null ? undefined : new Uint8Array(value as ArrayLike<number>);
  } catch {
    return undefined;
  }
}

function eventBytes(event: Record<string, unknown>, camelName: string): Uint8Array | undefined {
  const snakeName = camelName.replace(/[A-Z]/g, (character) => `_${character.toLowerCase()}`);
  const value = event[camelName] ?? event[snakeName];
  if (value === undefined || value === null) return undefined;
  return value instanceof Uint8Array ? value : new Uint8Array(value as ArrayLike<number>);
}

function eventNumber(event: Record<string, unknown>, camelName: string): number | undefined {
  const snakeName = camelName.replace(/[A-Z]/g, (character) => `_${character.toLowerCase()}`);
  const value = event[camelName] ?? event[snakeName];
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint' && value <= BigInt(Number.MAX_SAFE_INTEGER)) return Number(value);
  return undefined;
}

function eventString(event: Record<string, unknown>, camelName: string): string | undefined {
  const snakeName = camelName.replace(/[A-Z]/g, (character) => `_${character.toLowerCase()}`);
  const value = event[camelName] ?? event[snakeName];
  return typeof value === 'string' ? value : undefined;
}

function stableInterfaceId(runtimeId: number | undefined): string | undefined {
  return Array.from(drivers.values()).find((driver) => driver.hasRuntimeId(runtimeId))?.stableId;
}

function runtimeInterfaceBindings(): RuntimeInterfaceBinding[] {
  return Array.from(drivers.values()).flatMap((driver) => {
    const runtimeIndex = driver.runtimeIndex();
    return runtimeIndex === undefined
      ? []
      : [{
          interfaceId: driver.stableId,
          runtimeIndex,
          networkFingerprint: driver.networkFingerprint,
        }];
  });
}

function currentChatMessagePath(
  destinationHash: string,
  networkSnapshot?: unknown,
): ChatMessagePathSnapshot | undefined {
  if (!node || !configuration) return undefined;
  try {
    const route = resolvePathRoute(
      networkSnapshot ?? node.exportNetworkPersistentState(),
      destinationHash,
      configuration.interfaces,
      stableInterfaceId,
    );
    if (route.hops === undefined) return undefined;
    return {
      hops: route.hops,
      ...(route.interfaceId ? { interfaceId: route.interfaceId } : {}),
      ...(route.interfaceName ? { interfaceName: route.interfaceName } : {}),
      ...(route.interfaceType ? { interfaceType: route.interfaceType } : {}),
    };
  } catch {
    return undefined;
  }
}

function currentOutboundChatMessageStamp(
  destinationHash: string,
  hasStamp: boolean,
): ChatMessageStamp | undefined {
  if (!node) return undefined;
  try {
    const destination = hexToBytes(destinationHash);
    return outboundChatMessageStamp({
      hasStamp,
      hasTicket: node.hasLxmfOutboundTicket(destination),
      targetCost: node.lxmfOutboundStampCost(destination),
    });
  } catch {
    return undefined;
  }
}

function eventBoolean(event: Record<string, unknown>, camelName: string): boolean | undefined {
  const snakeName = camelName.replace(/[A-Z]/g, (character) => `_${character.toLowerCase()}`);
  const value = event[camelName] ?? event[snakeName];
  return typeof value === 'boolean' ? value : undefined;
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function scheduleNextTick(): void {
  if (tickTimer !== undefined) clearTimeout(tickTimer);
  if (!node) return;

  const deadline = node.nextDeadlineMs();
  const deadlineNumber = deadline === undefined ? Number.NaN : Number(deadline);
  const delay = Number.isFinite(deadlineNumber)
    ? Math.min(Math.max(0, deadlineNumber - Date.now()), maxTimerDelayMs)
    : idleDeadlineCheckMs;
  tickTimer = setTimeout(() => {
    tickTimer = undefined;
    try {
      processOutput(node?.tick() as WasmOutput | undefined);
    } catch (error) {
      emit({ type: 'runtimeError', code: errorCode(error) });
      scheduleNextTick();
    }
  }, delay);
}

function queueSnapshotPersistence(): void {
  persistenceQueue = persistenceQueue
    .then(() => persistSnapshot())
    .then(() => undefined)
    .catch(() => {
      emit({ type: 'runtimeError', code: 'RUNTIME_SNAPSHOT_PERSIST_FAILED' });
    });
}

async function persistSnapshot(
  transformNetworkState?: (
    snapshot: Record<string, unknown>,
  ) => Record<string, unknown>,
): Promise<ExportedRuntimePersistentState | undefined> {
  if (!node || !identity || !wrappingKey) return undefined;
  const identityPersistentState = node.exportIdentityPersistentState();
  const exportedNetworkState = node.exportNetworkPersistentState() as Record<string, unknown>;
  const networkPersistentState = transformNetworkState
    ? transformNetworkState(exportedNetworkState)
    : exportedNetworkState;
  const encryptedSnapshot = await encrypt(encodeSnapshot(identityPersistentState));
  const encryptedNetworkSnapshot = await encrypt(encodeSnapshot(networkPersistentState));
  const now = new Date().toISOString();
  const updated: PersistedIdentityRecord = {
    ...identity,
    encryptedSnapshot,
    updatedAt: now,
  };
  const updatedNetworkState: PersistedNetworkStateRecord = {
    schemaVersion: 1,
    encryptedSnapshot: encryptedNetworkSnapshot,
    updatedAt: now,
  };
  const [identitySaved, networkSaved] = await Promise.all([
    requestIdentitySave(updated),
    requestNetworkStateSave(updatedNetworkState),
  ]);
  const persisted = identitySaved && networkSaved;
  if (persisted) {
    identity = updated;
    persistedNetworkState = updatedNetworkState;
    node.clearDirtyPersistentState();
    log('debug', 'persistence', 'SNAPSHOT_PERSISTED');
    emitPropagationNodeSnapshot();
  }
  return {
    identity: identityPersistentState,
    network: networkPersistentState,
    persisted,
  };
}

async function persistIdentityDisplayName(displayName: string): Promise<boolean> {
  if (!identity) return false;
  const updated: PersistedIdentityRecord = {
    ...identity,
    label: displayName,
    displayName,
    updatedAt: new Date().toISOString(),
  };
  if (!await requestIdentitySave(updated)) return false;
  identity = updated;
  if (node) {
    announceLxmf('automatic');
    scheduleAutomaticAnnounce();
  }
  return true;
}

async function persistedIdentityFromGenerated(
  generated: GeneratedIdentity,
  metadata: { id: string; label: string; displayName: string },
): Promise<PersistedIdentityRecord> {
  const now = new Date().toISOString();
  const generatedPrivateKey = new Uint8Array(generated.privateKey);
  const encryptedPrivateKey = await encrypt(generatedPrivateKey);
  generatedPrivateKey.fill(0);
  return {
    id: metadata.id,
    schemaVersion: 1,
    label: metadata.label,
    displayName: metadata.displayName,
    identityHash: new Uint8Array(generated.hash),
    publicKey: new Uint8Array(generated.publicKey),
    encryptedPrivateKey,
    createdAt: now,
    updatedAt: now,
  };
}

async function activateIdentityRecord(
  nextIdentity: PersistedIdentityRecord,
  nextBlockedDestinationHashes: string[],
  nextContactDestinationHashes: string[],
  nextInterfaceAnnounceHistory: InterfaceAnnounceHistoryRecord[],
): Promise<boolean> {
  if (!identity || !privateKey) return false;
  await persistSnapshot();
  const nextPrivateKey = await decrypt(nextIdentity.encryptedPrivateKey);
  const derived = ReticulumNode.identityFromPrivateKey(nextPrivateKey) as GeneratedIdentity;
  if (bytesToHex(new Uint8Array(derived.hash)) !== bytesToHex(nextIdentity.identityHash)) return false;

  const previousIdentity = identity;
  const previousPrivateKey = privateKey;
  const previousBlockedDestinationHashes = blockedDestinationHashes;
  const previousContactDestinationHashes = contactDestinationHashes;
  const previousInterfaceAnnounceHistory = interfaceAnnounceHistory;
  if (!await requestActivationStorage(nextIdentity.id)) return false;

  identity = nextIdentity;
  privateKey = nextPrivateKey;
  blockedDestinationHashes = nextBlockedDestinationHashes;
  contactDestinationHashes = normalizeDestinationHashes(nextContactDestinationHashes);
  interfaceAnnounceHistory = normalizedInterfaceAnnounceHistory(nextInterfaceAnnounceHistory);
  pruneInterfaceAnnounceHistory(configuration?.interfaces ?? []);
  try {
    await rebuildRuntime(false);
    return true;
  } catch {
    identity = previousIdentity;
    privateKey = previousPrivateKey;
    blockedDestinationHashes = previousBlockedDestinationHashes;
    contactDestinationHashes = previousContactDestinationHashes;
    interfaceAnnounceHistory = previousInterfaceAnnounceHistory;
    await requestActivationStorage(previousIdentity.id);
    await rebuildRuntime(false);
    return false;
  }
}

function requestIdentitySave(record: PersistedIdentityRecord, activate = false): Promise<boolean> {
  const requestId = crypto.randomUUID();
  emit({ type: 'persistIdentity', requestId, identity: record, activate });
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      persistenceWaiters.delete(requestId);
      resolve(false);
    }, 10_000);
    persistenceWaiters.set(requestId, (ok) => {
      clearTimeout(timeout);
      resolve(ok);
    });
  });
}

function requestNetworkStateSave(record: PersistedNetworkStateRecord): Promise<boolean> {
  const requestId = crypto.randomUUID();
  emit({ type: 'persistNetworkState', requestId, networkState: record });
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      networkPersistenceWaiters.delete(requestId);
      resolve(false);
    }, 10_000);
    networkPersistenceWaiters.set(requestId, (ok) => {
      clearTimeout(timeout);
      resolve(ok);
    });
  });
}

function requestActivationStorage(identityId: string): Promise<boolean> {
  const requestId = crypto.randomUUID();
  emit({ type: 'identityActivationStorageRequested', requestId, identityId });
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      activationStorageWaiters.delete(requestId);
      resolve(false);
    }, 10_000);
    activationStorageWaiters.set(requestId, (ok) => {
      clearTimeout(timeout);
      resolve(ok);
    });
  });
}

async function encrypt(plaintext: Uint8Array): Promise<EncryptedPayload> {
  if (!wrappingKey) throw new Error('RUNTIME_WRAPPING_KEY_MISSING');
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: Uint8Array.from(iv).buffer },
    wrappingKey,
    Uint8Array.from(plaintext).buffer,
  );
  return { algorithm: 'AES-GCM', iv, ciphertext: new Uint8Array(ciphertext) };
}

async function decrypt(payload: EncryptedPayload): Promise<Uint8Array> {
  if (!wrappingKey) throw new Error('RUNTIME_WRAPPING_KEY_MISSING');
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: Uint8Array.from(payload.iv).buffer },
    wrappingKey,
    Uint8Array.from(payload.ciphertext).buffer,
  );
  return new Uint8Array(plaintext);
}

function encodeSnapshot(value: unknown): Uint8Array {
  const json = JSON.stringify(value, (_key, item: unknown) => {
    if (typeof item === 'bigint') return { __retivumType: 'bigint', value: item.toString() };
    if (ArrayBuffer.isView(item)) {
      const view = item as ArrayBufferView;
      return { __retivumType: 'bytes', value: Array.from(new Uint8Array(view.buffer, view.byteOffset, view.byteLength)) };
    }
    return item;
  });
  return new TextEncoder().encode(json);
}

function decodeSnapshot(bytes: Uint8Array): unknown {
  return JSON.parse(new TextDecoder().decode(bytes), (_key, item: unknown) => {
    if (!item || typeof item !== 'object') return item;
    const tagged = item as { __retivumType?: string; value?: string | number[] };
    if (tagged.__retivumType === 'bigint' && typeof tagged.value === 'string') return BigInt(tagged.value);
    if (tagged.__retivumType === 'bytes' && Array.isArray(tagged.value)) return new Uint8Array(tagged.value);
    return item;
  });
}

function hexToBytes(value: string): Uint8Array {
  const normalized = value.replace(/^0x/i, '').replace(/\s+/g, '');
  if (!normalized || normalized.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(normalized)) {
    throw new Error('RUNTIME_PROPAGATION_HASH_INVALID');
  }
  const bytes = new Uint8Array(normalized.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(normalized.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function errorCode(error: unknown): string {
  const message = typeof error === 'string' ? error : error instanceof Error ? error.message : '';
  if (/^RUNTIME_[A-Z_]+$/.test(message)) return message;
  if (message === 'NotFound' || message === 'PropagationNodeUnavailable') {
    return 'LXMF_PROPAGATION_NODE_UNAVAILABLE';
  }
  if (message === 'QueueFull') return 'LXMF_MESSAGE_QUEUE_FULL';
  if (message === 'Duplicate') return 'LXMF_MESSAGE_DUPLICATE';
  return 'RUNTIME_OPERATION_FAILED';
}

function emitAggregateStatus(): void {
  const enabledCount = configuration?.interfaces.filter((item) => item.enabled).length ?? 0;
  if (enabledCount === 0) {
    emit({ type: 'runtimeStatus', state: 'noInterfaces' });
    return;
  }
  const states = Array.from(drivers.values(), (driver) => driver.state);
  let state: RuntimeState = 'offline';
  if (states.includes('online')) state = 'online';
  else if (states.some((item) => item === 'connecting' || item === 'reconnecting')) state = 'connecting';
  else if (states.includes('error')) state = 'error';
  emit({ type: 'runtimeStatus', state });
}

function emitStatusDetails(): void {
  if (!configuration) return;
  const transportEnabled = configuration.preferences.transportEnabled;
  emit({
    type: 'statusDetails',
    details: {
      network: {
        activeLinks: node?.activeLinkCount() ?? 0,
        transportEnabled,
        ...(transportEnabled && node ? { transportHashHex: bytesToHex(node.identityHash()) } : {}),
        transportedPackets: transportEnabled && node ? Number(node.transportedPacketCount()) : 0,
      },
      interfaces: Array.from(drivers.values(), (driver) => driver.telemetry.snapshot()),
    },
  });
}

function closeAllActiveLinks(): void {
  if (!node) return;
  // Explicit operator teardown must not trigger the one-shot recovery paths
  // used for incidental NomadNet or provisioning link loss.
  clearNomadState('NOMAD_LINKS_CLOSED');
  clearProvisioningState('PROVISIONING_LINKS_CLOSED');
  for (const linkId of Array.from(activeLinkIds)) {
    try {
      processOutput(node.closeLink(hexToBytes(linkId)) as WasmOutput);
    } catch (error) {
      log('debug', 'wasm', 'LINK_ALREADY_CLOSED', {
        linkId,
        message: error instanceof Error ? error.message : String(error),
      });
      activeLinkIds.delete(linkId);
    }
  }
  emitStatusDetails();
}

function driverForRuntimeId(runtimeId: number | undefined): InterfaceDriver | undefined {
  return Array.from(drivers.values()).find((driver) => driver.hasRuntimeId(runtimeId));
}

class PlatformInterfaceDriver implements InterfaceDriver {
  state: InterfaceRuntimeState = 'offline';
  readonly telemetry: InterfaceTelemetryTracker;
  private runtimeId?: number;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private reconnectAttempt = 0;
  private closedByRuntime = false;

  constructor(private readonly config: Exclude<InterfaceConfig, WebSocketInterfaceConfig>) {
    this.telemetry = new InterfaceTelemetryTracker(config);
  }

  get stableId(): string {
    return this.config.id;
  }

  get reannounceOnReconnect(): boolean {
    return this.config.reannounceOnReconnect;
  }

  get networkFingerprint(): string {
    return interfaceNetworkFingerprint(this.config);
  }

  runtimeIndex(): number | undefined {
    return this.runtimeId;
  }

  hasRuntimeId(runtimeId: number | undefined): boolean {
    return runtimeId !== undefined && runtimeId === this.runtimeId;
  }

  attach(owner: ReticulumNode): void {
    const radio = this.config.type === 'rnode' ? this.config.radio : undefined;
    this.runtimeId = owner.addInterface({
      name: this.config.name,
      mode: leviculumInterfaceMode(this.config.mode),
      ...(radio ? {
        hwMtu: 508,
        bitrateBps: computeRNodeBitrate(radio.spreadingFactor, radio.codingRate, radio.bandwidth),
      } : {}),
    });
  }

  connect(): void {
    this.closedByRuntime = false;
    this.setState(this.reconnectAttempt > 0 ? 'reconnecting' : 'connecting');
    emit({ type: 'platformInterfaceOpen', config: this.config });
  }

  disconnect(notifyNode = true): void {
    this.closedByRuntime = true;
    if (this.reconnectTimer !== undefined) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
    emit({ type: 'platformInterfaceClose', id: this.config.id });
    if (notifyNode) this.setOnline(false);
    this.setState('offline');
  }

  dispatch(action: WasmAction): boolean {
    if (this.state !== 'online' || this.runtimeId === undefined || !actionTargetsRuntimeInterface(action, this.runtimeId)) return false;
    const data = new Uint8Array(action.data);
    this.telemetry.recordTransmit(data.byteLength, action.packet.packetType === 'announce');
    emit({
      type: 'platformInterfaceWrite',
      id: this.config.id,
      data,
      highPriority: action.packet.highPriority,
    });
    return true;
  }

  receive(data: Uint8Array): void {
    if (this.state !== 'online' || !node || this.runtimeId === undefined || data.byteLength === 0) return;
    this.telemetry.recordReceive(data.byteLength);
    receiveReticulumFrame(this.runtimeId, data);
  }

  handlePlatformState(state: 'online' | 'offline' | 'error', errorCode?: string): void {
    if (this.closedByRuntime) return;
    if (state === 'online') {
      const wasOnline = this.state === 'online';
      this.reconnectAttempt = 0;
      if (wasOnline) return;
      this.setState('online');
      this.setOnline(true);
      handleInterfaceOnline(this);
      return;
    }
    this.setOnline(false);
    if (state === 'error') this.setState('error', errorCode ?? 'PLATFORM_INTERFACE_ERROR');
    // RNodeHost owns BLE/serial teardown and reconnect so it can retain the
    // authorized BluetoothDevice and protocol state. Recreating the platform
    // host here as well races its own reconnect timer, produces duplicate
    // online transitions, and loses Electron's in-memory Web Bluetooth grant.
    if (this.config.type === 'rnode') {
      this.setState('reconnecting', errorCode);
      return;
    }
    if (this.reconnectTimer === undefined) this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    this.reconnectAttempt += 1;
    const base = Math.min(reconnectMaximumDelayMs, reconnectInitialDelayMs * reconnectMultiplier ** (this.reconnectAttempt - 1));
    const jitter = base * reconnectJitter * (Math.random() * 2 - 1);
    this.setState('reconnecting');
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      emit({ type: 'platformInterfaceClose', id: this.config.id });
      this.connect();
    }, Math.max(0, base + jitter));
  }

  private setOnline(online: boolean): void {
    if (node && this.runtimeId !== undefined) {
      processOutput(
        node.setInterfaceOnline(this.runtimeId, online) as WasmOutput,
        online ? { suppressAnnounces: true } : undefined,
      );
    }
  }

  private setState(state: InterfaceRuntimeState, errorCode?: string): void {
    const changed = this.state !== state;
    this.state = state;
    this.telemetry.setState(state);
    if (changed || errorCode) log(errorCode ? 'error' : 'info', 'runtime', errorCode ?? `INTERFACE_${state.toUpperCase()}`, { interfaceId: this.config.id });
    emit({ type: 'interfaceStatus', id: this.config.id, state, errorCode });
    emitAggregateStatus();
  }
}

function actionTargetsRuntimeInterface(action: WasmAction, runtimeId: number): boolean {
  if (action.type === 'send') return action.iface === runtimeId;
  if (action.type !== 'broadcast') return false;
  const excluded = new Set(action.excludeIfaces ?? []);
  if (action.excludeIface !== undefined) excluded.add(action.excludeIface);
  return !excluded.has(runtimeId);
}

function logNomadProtocolAction(action: WasmAction, dispatched: number): void {
  const data = new Uint8Array(action.data);
  const destinationHash = action.packet.destinationHash
    ? bytesToHex(new Uint8Array(action.packet.destinationHash))
    : undefined;
  if (action.packet.packetType === 'linkRequest' && destinationHash
    && nomadLinksByDestination.has(destinationHash)) {
    log(dispatched > 0 ? 'debug' : 'warning', 'wasm', 'NOMAD_LINK_REQUEST_DISPATCHED', {
      destinationHash,
      bytes: data.byteLength,
      interfaces: dispatched,
    });
    return;
  }
  if (action.packet.context === 0xfe && destinationHash
    && nomadLinksById.has(destinationHash)) {
    log(dispatched > 0 ? 'debug' : 'warning', 'wasm', 'NOMAD_LINK_RTT_DISPATCHED', {
      linkId: destinationHash,
      bytes: data.byteLength,
      interfaces: dispatched,
    });
    return;
  }
  if (action.packet.context === 0x03 && destinationHash
    && nomadLinksById.has(destinationHash)) {
    log(dispatched > 0 ? 'debug' : 'warning', 'wasm', 'NOMAD_RESOURCE_REQUEST_DISPATCHED', {
      linkId: destinationHash,
      bytes: data.byteLength,
      interfaces: dispatched,
    });
  }
}

function receiveReticulumFrame(runtimeId: number, data: Uint8Array): void {
  if (!node) return;
  processOutput(node.receive(runtimeId, data) as WasmOutput);
}

class WebSocketDriver {
  state: InterfaceRuntimeState = 'offline';
  readonly telemetry: InterfaceTelemetryTracker;
  private runtimeId?: number;
  private socket?: WebSocket;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private reconnectAttempt = 0;
  private closedByRuntime = false;
  private generation = 0;

  constructor(private readonly config: WebSocketInterfaceConfig) {
    this.telemetry = new InterfaceTelemetryTracker(config);
  }

  get stableId(): string {
    return this.config.id;
  }

  get reannounceOnReconnect(): boolean {
    return this.config.reannounceOnReconnect;
  }

  get networkFingerprint(): string {
    return interfaceNetworkFingerprint(this.config);
  }

  runtimeIndex(): number | undefined {
    return this.runtimeId;
  }

  hasRuntimeId(runtimeId: number | undefined): boolean {
    return runtimeId !== undefined && this.runtimeId === runtimeId;
  }

  attach(owner: ReticulumNode): void {
    this.runtimeId = owner.addInterface({ name: this.config.name, mode: leviculumInterfaceMode(this.config.mode) });
  }

  connect(): void {
    this.closeSocket();
    if (!node || this.runtimeId === undefined) return;
    this.closedByRuntime = false;
    const generation = ++this.generation;
    this.setState(this.reconnectAttempt > 0 ? 'reconnecting' : 'connecting');

    try {
      const socket = new WebSocket(interfaceUrl(this.config));
      socket.binaryType = 'arraybuffer';
      this.socket = socket;
      socket.addEventListener('open', () => {
        if (!this.isCurrent(socket, generation) || !node || this.runtimeId === undefined) return;
        this.reconnectAttempt = 0;
        this.setState('online');
        processOutput(
          node.setInterfaceOnline(this.runtimeId, true) as WasmOutput,
          { suppressAnnounces: true },
        );
        handleInterfaceOnline(this);
      });
      socket.addEventListener('message', (event) => void this.receive(socket, generation, event.data));
      socket.addEventListener('error', () => {
        if (this.isCurrent(socket, generation)) this.setState('error', 'WEBSOCKET_CONNECTION_ERROR');
      });
      socket.addEventListener('close', () => {
        if (!this.isCurrent(socket, generation)) return;
        this.socket = undefined;
        if (node && this.runtimeId !== undefined) {
          processOutput(node.setInterfaceOnline(this.runtimeId, false) as WasmOutput);
        }
        if (!this.closedByRuntime) this.scheduleReconnect();
        else this.setState('offline');
      });
    } catch {
      this.setState('error', 'WEBSOCKET_OPEN_FAILED');
      if (!this.closedByRuntime) this.scheduleReconnect();
    }
  }

  disconnect(notifyNode = true): void {
    this.closedByRuntime = true;
    if (this.reconnectTimer !== undefined) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
    if (notifyNode && node && this.runtimeId !== undefined) {
      processOutput(node.setInterfaceOnline(this.runtimeId, false) as WasmOutput);
    }
    this.closeSocket();
  }

  dispatch(action: WasmAction): boolean {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN || this.runtimeId === undefined) return false;
    if (action.type === 'send' && action.iface !== this.runtimeId) return false;
    if (action.type === 'broadcast') {
      const excluded = new Set(action.excludeIfaces ?? []);
      if (action.excludeIface !== undefined) excluded.add(action.excludeIface);
      if (excluded.has(this.runtimeId)) return false;
    } else if (action.type !== 'send') {
      return false;
    }
    const data = new Uint8Array(action.data);
    this.telemetry.recordTransmit(data.byteLength, action.packet.packetType === 'announce');
    this.socket.send(data);
    return true;
  }

  private async receive(socket: WebSocket, generation: number, data: unknown): Promise<void> {
    let bytes: Uint8Array | undefined;
    try {
      bytes = await messageBytes(data);
      if (!bytes || bytes.byteLength === 0 || !this.isCurrent(socket, generation) || !node || this.runtimeId === undefined) return;
      this.telemetry.recordReceive(bytes.byteLength);
      receiveReticulumFrame(this.runtimeId, bytes);
    } catch (error) {
      if (!this.isCurrent(socket, generation)) return;
      log('warning', 'websocket', 'WEBSOCKET_FRAME_INVALID', {
        interfaceId: this.config.id,
        ...(bytes ? { bytes: bytes.byteLength } : {}),
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private scheduleReconnect(): void {
    this.reconnectAttempt += 1;
    const base = Math.min(
      reconnectMaximumDelayMs,
      reconnectInitialDelayMs * reconnectMultiplier ** (this.reconnectAttempt - 1),
    );
    const jitter = base * reconnectJitter * (Math.random() * 2 - 1);
    this.setState('reconnecting');
    this.reconnectTimer = setTimeout(() => this.connect(), Math.max(0, base + jitter));
  }

  private closeSocket(): void {
    if (!this.socket) return;
    const socket = this.socket;
    this.socket = undefined;
    this.generation += 1;
    socket.close();
  }

  private isCurrent(socket: WebSocket, generation: number): boolean {
    return this.socket === socket && this.generation === generation;
  }

  private setState(state: InterfaceRuntimeState, errorCode?: string): void {
    const changed = this.state !== state;
    this.state = state;
    this.telemetry.setState(state);
    if (changed || errorCode) {
      log(errorCode ? 'error' : 'info', 'websocket', errorCode ?? `INTERFACE_${state.toUpperCase()}`, {
        interfaceId: this.config.id,
      });
    }
    emit({ type: 'interfaceStatus', id: this.config.id, state, errorCode });
    emitAggregateStatus();
  }
}

function interfaceUrl(config: WebSocketInterfaceConfig): string {
  const host = config.connection.host.includes(':') && !config.connection.host.startsWith('[')
    ? `[${config.connection.host}]`
    : config.connection.host;
  const port = config.connection.port ? `:${config.connection.port}` : '';
  return `${config.connection.scheme}://${host}${port}${config.connection.path}`;
}

async function messageBytes(data: unknown): Promise<Uint8Array | undefined> {
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (data instanceof Blob) return new Uint8Array(await data.arrayBuffer());
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  if (typeof data !== 'string') return undefined;

  const compact = data.trim().replace(/\s+/g, '');
  if (compact.length > maxTextFrameBytes * 2) throw new Error('WEBSOCKET_FRAME_TOO_LARGE');
  if (!compact) return new Uint8Array();
  if (/^(0x)?[0-9a-f]+$/i.test(compact)) return hexToBytes(compact);
  const decoded = atob(compact);
  if (decoded.length > maxTextFrameBytes) throw new Error('WEBSOCKET_FRAME_TOO_LARGE');
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
}
