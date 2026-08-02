<script lang="ts">
  import { onDestroy } from 'svelte';
  import { navigateBack } from '../../app/router';
  import type { LoadedProvisioningDevice } from '../../infrastructure/reticulum/provisioning-client';
  import type {
    ProvisioningField,
    ProvisioningNamespace,
    ProvisioningNode,
    ProvisioningState,
    ProvisioningValue,
  } from '../../domain/provisioning';
  import { provisioningFieldFlags, provisioningFieldTypes } from '../../domain/provisioning';
  import {
    destinationsByFullName,
    knownDestinationDirectory,
  } from '../../domain/known-destination';
  import { normalizeDestinationHash } from '../../domain/settings';
  import { ProvisioningClient } from '../../infrastructure/reticulum/provisioning-client';
  import { pendingProbeDestinationHashes } from '../../infrastructure/reticulum/probe-operations';
  import { probeTimeoutMsForPath } from '../../infrastructure/reticulum/timeouts';
  import {
    destinationPathStatuses,
    knownDestinations,
    remoteDestinationInventory,
    provisioningBookmarks,
    reticulumRuntime,
  } from '../../infrastructure/reticulum/runtime';
  import { createDateFormatter, locale, t } from '../../i18n';
  import {
    contextMenuTrigger,
    type ContextMenuOpenMethod,
  } from '../../lib/actions/contextMenuTrigger';
  import { copyText } from '../../lib/clipboard';
  import BookmarkEditor from '../../lib/components/BookmarkEditor.svelte';
  import ConfirmationDialog from '../../lib/components/ConfirmationDialog.svelte';
  import ContextMenu from '../../lib/components/ContextMenu.svelte';
  import Icon from '../../lib/components/Icon.svelte';
  import EmptyState from '../../lib/components/EmptyState.svelte';
  import PathStatus from '../../lib/components/PathStatus.svelte';
  import { showDestinationProbeActivity } from '../../lib/notifications/probe-activity';
  import { toast } from '../../lib/notifications/toasts';

  let selectedNodeId = $state<string>();
  let client = $state<ProvisioningClient>();
  let loaded = $state<LoadedProvisioningDevice>();
  let draft = $state<ProvisioningState>({});
  let commandValues = $state<Record<string, ProvisioningValue>>({});
  let dirtyFields = $state<string[]>([]);
  let firmwareDraftFields = $state<string[]>([]);
  let busy = $state(false);
  let loadingDevice = $state(false);
  let stage = $state<string>();
  let transferProgress = $state<number>();
  let transferSize = $state<number>();
  let managementDestination = $state('');
  let activeSection = $state('status');
  let query = $state('');
  let selectedNodeSnapshot = $state<ProvisioningNode>();
  let bookmarkEditor = $state<{ node: ProvisioningNode; mode: 'add' | 'edit' }>();
  let destinationActions = $state<{
    node: ProvisioningNode;
    x: number;
    y: number;
    autofocus: boolean;
    guardOpeningRelease: boolean;
  }>();
  let confirmation = $state<
    | { kind: 'commitAll' }
    | { kind: 'discardAll' }
    | { kind: 'command'; namespaceId: number; field: ProvisioningField }
    | { kind: 'reboot' }
    | { kind: 'factoryReset' }
  >();
  let loadSequence = 0;
  const heardAtFormatter = $derived(createDateFormatter($locale));
  const destinationDirectory = $derived(knownDestinationDirectory(
    $knownDestinations,
    $remoteDestinationInventory,
  ));
  const managementDestinations = $derived(destinationsByFullName(
    destinationDirectory,
    'rnstransport.remote.management',
  ));
  const provisioningNodes = $derived.by(() => {
    const destinationsByHash = new Map(managementDestinations.map((destination) => [
      destination.destinationHash,
      destination,
    ]));
    const bookmarked = $provisioningBookmarks
      .map((bookmark): ProvisioningNode => ({
        id: bookmark.id,
        destinationHash: bookmark.destinationHash,
        lastAnnouncedAt: destinationsByHash.get(bookmark.destinationHash)?.lastAnnouncedAt,
        bookmarked: true,
        label: bookmark.label,
      }))
      .sort((left, right) => (
        (left.label?.trim() ?? '').localeCompare(right.label?.trim() ?? '')
        || left.destinationHash.localeCompare(right.destinationHash)
      ));
    const bookmarkedHashes = new Set(bookmarked.map((node) => node.destinationHash));
    const announced = managementDestinations
      .filter((destination) => !bookmarkedHashes.has(destination.destinationHash))
      .map((destination): ProvisioningNode => ({
        id: destination.destinationHash,
        destinationHash: destination.destinationHash,
        lastAnnouncedAt: destination.lastAnnouncedAt,
      }));
    announced.sort((left, right) => (
      (right.lastAnnouncedAt ?? '').localeCompare(left.lastAnnouncedAt ?? '')
      || left.destinationHash.localeCompare(right.destinationHash)
    ));
    return [...bookmarked, ...announced];
  });
  const selectedNode = $derived(
    provisioningNodes.find((node) => node.id === selectedNodeId)
      ?? (selectedNodeSnapshot?.id === selectedNodeId ? selectedNodeSnapshot : undefined),
  );
  const destinationNode = $derived(provisioningNodes.find((node) => (
    node.destinationHash === managementDestination.trim().toLowerCase()
  )));
  const normalizedQuery = $derived(query.trim().toLowerCase());
  const filteredNodes = $derived(provisioningNodes.filter((node) => [
    nodeName(node),
    node.label,
    node.destinationHash,
  ].some((value) => value?.toLowerCase().includes(normalizedQuery))));
  const bookmarkedNodes = $derived(filteredNodes.filter((node) => node.bookmarked === true));
  const announcedNodes = $derived(filteredNodes.filter((node) => node.bookmarked !== true));
  const normalizedDestination = $derived(normalizeDestinationHash(managementDestination));
  const rootNamespaces = $derived(loaded?.schema.namespaces.filter((namespace) => namespace.parentId === 0) ?? []);
  const activeNamespaceId = $derived(activeSection.startsWith('namespace:')
    ? Number(activeSection.slice('namespace:'.length))
    : undefined);
  const visibleNamespaces = $derived(activeNamespaceId === undefined || !loaded
    ? []
    : namespaceTree(loaded.schema.namespaces, activeNamespaceId));
  const activeNamespaceIds = $derived(new Set(visibleNamespaces.map((namespace) => namespace.id)));
  const activeDirtyFieldCount = $derived(dirtyFields.filter((key) => (
    activeNamespaceIds.has(Number(key.split(':', 1)[0]))
  )).length);
  const activeFirmwareDraftCount = $derived(firmwareDraftFields.filter((key) => (
    activeNamespaceIds.has(Number(key.split(':', 1)[0]))
  )).length);

  onDestroy(() => {
    loadSequence += 1;
    reticulumRuntime.closeProvisioning();
  });

  function nodeName(node: ProvisioningNode): string {
    return node.label
      ?? announcedNodeName(node)
      ?? '';
  }

  function announcedNodeName(node: ProvisioningNode): string | undefined {
    const destination = managementDestinations.find((destination) => (
      destination.destinationHash === node.destinationHash
    ));
    return destination?.displayName ?? destination?.sharedDisplayName;
  }

  async function selectNode(node: ProvisioningNode): Promise<void> {
    if (selectedNode || client || busy) return;
    if (selectedNodeId !== node.id) {
      loaded = undefined;
      draft = {};
      commandValues = {};
      dirtyFields = [];
      firmwareDraftFields = [];
      activeSection = 'status';
    }
    selectedNodeSnapshot = node;
    selectedNodeId = node.id;
    managementDestination = node.destinationHash;
    client = createClient(node);
    await loadDevice();
  }

  function createClient(node: ProvisioningNode): ProvisioningClient {
    return new ProvisioningClient(node, (nextStage, progress, dataSize) => {
      stage = nextStage;
      transferProgress = progress;
      transferSize = dataSize;
    });
  }

  function connectToDestination(event: SubmitEvent): void {
    event.preventDefault();
    if (!normalizedDestination) return;
    const node = destinationNode ?? {
      id: normalizedDestination,
      destinationHash: normalizedDestination,
    };
    void selectNode(node);
  }

  function editBookmark(node: ProvisioningNode): void {
    bookmarkEditor = { node, mode: node.bookmarked ? 'edit' : 'add' };
  }

  async function saveBookmark(name: string): Promise<boolean> {
    if (!bookmarkEditor) return false;
    try {
      return await reticulumRuntime.saveProvisioningNodeBookmark(bookmarkEditor.node, name);
    } catch {
      return false;
    }
  }

  async function removeBookmark(node: ProvisioningNode): Promise<void> {
    try {
      if (!await reticulumRuntime.setProvisioningNodeBookmarked(node.id, false)) {
        toast.error('provisioning.bookmark.failed');
      }
    } catch {
      toast.error('provisioning.bookmark.failed');
    }
  }

  function openDestinationActions(
    node: ProvisioningNode,
    x: number,
    y: number,
    method: ContextMenuOpenMethod,
  ): void {
    destinationActions = {
      node,
      x,
      y,
      autofocus: method === 'keyboard',
      guardOpeningRelease: method === 'longpress',
    };
  }

  function closeDestinationActions(): void {
    destinationActions = undefined;
  }

  async function copyDestinationHash(destinationHash: string): Promise<void> {
    closeDestinationActions();
    if (await copyText(destinationHash)) toast.success('common.copied');
    else toast.error('common.copyFailed');
  }

  function copyActiveDestination(): void {
    if (selectedNode) void copyDestinationHash(selectedNode.destinationHash);
  }

  function probeDestination(node: ProvisioningNode): void {
    closeDestinationActions();
    showDestinationProbeActivity({
      destinationHash: node.destinationHash,
      displayName: nodeName(node) || undefined,
      fullDestinationName: 'rnstransport.probe',
      timeoutMs: probeTimeoutMsForPath($destinationPathStatuses[node.destinationHash]),
    });
  }

  async function loadDevice(): Promise<void> {
    if (!client || busy) return;
    const activeClient = client;
    const sequence = ++loadSequence;
    busy = true;
    loadingDevice = true;
    stage = 'findingPath';
    transferProgress = undefined;
    transferSize = undefined;
    try {
      const nextLoaded = await activeClient.load();
      if (sequence !== loadSequence || client !== activeClient) return;
      loaded = nextLoaded;
      draft = provisioningStateWithDrafts(nextLoaded.state, nextLoaded.drafts);
      dirtyFields = [];
      firmwareDraftFields = provisioningStateFieldKeys(nextLoaded.drafts);
      if (activeSection !== 'status' && !nextLoaded.schema.namespaces.some((namespace) => (
        namespace.parentId === 0 && namespace.id === activeNamespaceId
      ))) activeSection = 'status';
      stage = undefined;
    } catch {
      if (sequence !== loadSequence || client !== activeClient) return;
      stage = undefined;
    } finally {
      if (sequence === loadSequence && client === activeClient) {
        busy = false;
        loadingDevice = false;
      }
    }
  }

  async function refreshActiveSection(): Promise<void> {
    if (!selectedNode || busy) return;
    if (!loaded) {
      client?.close();
      client = createClient(selectedNode);
      await loadDevice();
      return;
    }
    if (!client) return;
    const activeClient = client;
    const activeLoaded = loaded;
    const sequence = ++loadSequence;
    busy = true;
    stage = 'requesting';
    transferProgress = undefined;
    transferSize = undefined;
    try {
      if (activeSection === 'status') {
        const info = await activeClient.getInfo();
        if (sequence !== loadSequence || client !== activeClient) return;
        loaded = { ...activeLoaded, info };
      } else if (activeNamespaceId !== undefined) {
        const namespaceIds = namespaceTree(activeLoaded.schema.namespaces, activeNamespaceId)
          .map((namespace) => namespace.id);
        if (!namespaceIds.length) {
          stage = undefined;
          return;
        }
        const snapshot = await activeClient.getStateSnapshot(namespaceIds, true);
        if (sequence !== loadSequence || client !== activeClient) return;
        const refreshedState = refreshedNamespaceState(namespaceIds, snapshot.values);
        const refreshedDrafts = snapshot.drafts ?? {};
        const retainedDrafts = Object.fromEntries(Object.entries(activeLoaded.drafts ?? {})
          .filter(([namespaceId]) => !namespaceIds.includes(Number(namespaceId))));
        loaded = {
          ...activeLoaded,
          state: { ...activeLoaded.state, ...refreshedState },
          drafts: { ...retainedDrafts, ...refreshedDrafts },
        };
        draft = {
          ...draft,
          ...provisioningStateWithDrafts(refreshedState, refreshedDrafts),
        };
        const refreshedNamespaceIds = new Set(namespaceIds);
        dirtyFields = dirtyFields.filter((key) => !refreshedNamespaceIds.has(Number(key.split(':', 1)[0])));
        firmwareDraftFields = [
          ...firmwareDraftFields.filter((key) => !refreshedNamespaceIds.has(Number(key.split(':', 1)[0]))),
          ...provisioningStateFieldKeys(refreshedDrafts),
        ];
      }
      stage = undefined;
    } catch {
      if (sequence !== loadSequence || client !== activeClient) return;
      stage = undefined;
    } finally {
      if (sequence === loadSequence && client === activeClient) busy = false;
    }
  }

  function disconnectDevice(): void {
    if (!selectedNode && !client) return;
    loadSequence += 1;
    client?.close();
    client = undefined;
    selectedNodeId = undefined;
    selectedNodeSnapshot = undefined;
    loaded = undefined;
    draft = {};
    commandValues = {};
    dirtyFields = [];
    firmwareDraftFields = [];
    busy = false;
    loadingDevice = false;
    stage = undefined;
    transferProgress = undefined;
    transferSize = undefined;
    activeSection = 'status';
    confirmation = undefined;
  }

  function namespaceTree(namespaces: ProvisioningNamespace[], rootId: number): ProvisioningNamespace[] {
    const result: ProvisioningNamespace[] = [];
    const seen = new Set<number>();
    const visit = (namespaceId: number): void => {
      if (seen.has(namespaceId)) return;
      const namespace = namespaces.find((candidate) => candidate.id === namespaceId);
      if (!namespace) return;
      seen.add(namespaceId);
      result.push(namespace);
      for (const child of namespaces) if (child.parentId === namespaceId) visit(child.id);
    };
    visit(rootId);
    return result;
  }

  function namespaceDepth(namespaceId: number): number {
    if (!loaded || activeNamespaceId === undefined || namespaceId === activeNamespaceId) return 0;
    let current = loaded.schema.namespaces.find((namespace) => namespace.id === namespaceId);
    let depth = 0;
    const visited = new Set<number>();
    while (current && current.id !== activeNamespaceId && !visited.has(current.id)) {
      visited.add(current.id);
      depth += 1;
      current = loaded.schema.namespaces.find((namespace) => namespace.id === current?.parentId);
    }
    return current?.id === activeNamespaceId ? depth : 0;
  }

  function namespaceIsReadOnly(namespaceId: number): boolean {
    if (!loaded) return false;
    const fields = namespaceTree(loaded.schema.namespaces, namespaceId)
      .flatMap((namespace) => namespace.fields);
    return fields.length > 0 && fields.every((field) => fieldIsReadOnly(field));
  }

  function fieldKey(namespaceId: number, fieldId: number): string {
    return `${namespaceId}:${fieldId}`;
  }

  function fieldValue(namespaceId: number, field: ProvisioningField): ProvisioningValue | undefined {
    return draft[namespaceId]?.[field.id] ?? field.defaultValue;
  }

  function updateField(namespaceId: number, field: ProvisioningField, value: ProvisioningValue): void {
    draft = {
      ...draft,
      [namespaceId]: { ...(draft[namespaceId] ?? {}), [field.id]: value },
    };
    const key = fieldKey(namespaceId, field.id);
    if (provisioningValuesEqual(value, originalFieldValue(namespaceId, field))) {
      dirtyFields = dirtyFields.filter((candidate) => candidate !== key);
    } else if (!dirtyFields.includes(key)) dirtyFields = [...dirtyFields, key];
  }

  function originalFieldValue(namespaceId: number, field: ProvisioningField): ProvisioningValue | undefined {
    const firmwareDraft = loaded?.drafts?.[namespaceId];
    if (firmwareDraft && Object.prototype.hasOwnProperty.call(firmwareDraft, field.id)) {
      return firmwareDraft[field.id];
    }
    const committed = loaded?.state?.[namespaceId];
    if (committed && Object.prototype.hasOwnProperty.call(committed, field.id)) {
      return committed[field.id];
    }
    return field.defaultValue;
  }

  function provisioningValuesEqual(
    left: ProvisioningValue | undefined,
    right: ProvisioningValue | undefined,
  ): boolean {
    if (Object.is(left, right)) return true;
    const leftBytes = byteArrayValue(left);
    const rightBytes = byteArrayValue(right);
    if (leftBytes && rightBytes) {
      return leftBytes.length === rightBytes.length
        && leftBytes.every((byte, index) => byte === rightBytes[index]);
    }
    if (Array.isArray(left) && Array.isArray(right)) {
      return left.length === right.length && left.every((value, index) => (
        provisioningValuesEqual(value, right[index])
      ));
    }
    if (left instanceof Map && right instanceof Map) {
      if (left.size !== right.size) return false;
      return Array.from(left).every(([leftKey, leftValue]) => Array.from(right).some(
        ([rightKey, rightValue]) => provisioningValuesEqual(leftKey, rightKey)
          && provisioningValuesEqual(leftValue, rightValue),
      ));
    }
    return false;
  }

  function byteArrayValue(value: ProvisioningValue | undefined): readonly number[] | undefined {
    if (value instanceof Uint8Array) return Array.from(value);
    if (Array.isArray(value) && value.every((byte) => (
      typeof byte === 'number' && Number.isInteger(byte) && byte >= 0 && byte <= 255
    ))) return value as number[];
    if (value && typeof value === 'object' && !(value instanceof Map)) {
      const indexedBytes = Object.entries(value)
        .filter(([key]) => /^\d+$/.test(key))
        .sort(([left], [right]) => Number(left) - Number(right))
        .map(([, byte]) => byte);
      if (indexedBytes.length > 0 && indexedBytes.every((byte) => (
        typeof byte === 'number' && Number.isInteger(byte) && byte >= 0 && byte <= 255
      ))) return indexedBytes as number[];
    }
    return undefined;
  }

  function editableFieldValue(namespaceId: number, field: ProvisioningField): ProvisioningValue | undefined {
    return fieldIsWriteOnly(field)
      ? commandValues[fieldKey(namespaceId, field.id)] ?? field.defaultValue
      : fieldValue(namespaceId, field);
  }

  function updateEditableField(namespaceId: number, field: ProvisioningField, value: ProvisioningValue): void {
    if (fieldIsWriteOnly(field)) {
      commandValues = { ...commandValues, [fieldKey(namespaceId, field.id)]: value };
    } else updateField(namespaceId, field, value);
  }

  function fieldIsReadOnly(field: ProvisioningField): boolean {
    return !fieldIsWriteOnly(field) && (field.flags & provisioningFieldFlags.readOnly) !== 0;
  }

  function fieldIsWriteOnly(field: ProvisioningField): boolean {
    return (field.flags & provisioningFieldFlags.writeOnly) !== 0;
  }

  function fieldIsSecret(field: ProvisioningField): boolean {
    return (field.flags & provisioningFieldFlags.secret) !== 0;
  }

  function editableState(namespaceIds: ReadonlySet<number>): ProvisioningState {
    const result: ProvisioningState = {};
    for (const key of dirtyFields) {
      const [namespaceId, fieldId] = key.split(':').map(Number);
      if (!namespaceIds.has(namespaceId)) continue;
      const value = draft[namespaceId]?.[fieldId];
      if (value === undefined) continue;
      result[namespaceId] = { ...(result[namespaceId] ?? {}), [fieldId]: value };
    }
    return result;
  }

  function refreshedNamespaceState(
    namespaceIds: readonly number[],
    nextState: ProvisioningState,
  ): ProvisioningState {
    return Object.fromEntries(namespaceIds.map((namespaceId) => [
      namespaceId,
      structuredClone(nextState[namespaceId] ?? {}),
    ]));
  }

  function provisioningStateWithDrafts(
    state: ProvisioningState,
    drafts: ProvisioningState = {},
  ): ProvisioningState {
    const result = structuredClone(state);
    for (const [namespaceId, fields] of Object.entries(drafts)) {
      result[Number(namespaceId)] = {
        ...(result[Number(namespaceId)] ?? {}),
        ...structuredClone(fields),
      };
    }
    return result;
  }

  function provisioningStateFieldKeys(state: ProvisioningState = {}): string[] {
    return Object.entries(state).flatMap(([namespaceId, fields]) => (
      Object.keys(fields).map((fieldId) => fieldKey(Number(namespaceId), Number(fieldId)))
    ));
  }

  async function saveNamespace(): Promise<void> {
    if (!client || !loaded || busy || activeDirtyFieldCount === 0) return;
    const activeLoaded = loaded;
    const namespaceIds = new Set(activeNamespaceIds);
    const stagedKeys = dirtyFields.filter((key) => namespaceIds.has(Number(key.split(':', 1)[0])));
    busy = true;
    try {
      const result = await client.stage(editableState(namespaceIds));
      if (result.values) {
        const refreshedState = refreshedNamespaceState(Array.from(namespaceIds), result.values);
        const refreshedDrafts = result.drafts ?? {};
        const retainedDrafts = Object.fromEntries(Object.entries(activeLoaded.drafts ?? {})
          .filter(([namespaceId]) => !namespaceIds.has(Number(namespaceId))));
        loaded = {
          ...activeLoaded,
          state: { ...activeLoaded.state, ...refreshedState },
          drafts: { ...retainedDrafts, ...refreshedDrafts },
        };
        draft = {
          ...draft,
          ...provisioningStateWithDrafts(refreshedState, refreshedDrafts),
        };
        firmwareDraftFields = [
          ...firmwareDraftFields.filter((key) => !namespaceIds.has(Number(key.split(':', 1)[0]))),
          ...provisioningStateFieldKeys(refreshedDrafts),
        ];
      } else if (result.applied > 0) firmwareDraftFields = Array.from(new Set([
        ...firmwareDraftFields,
        ...stagedKeys,
      ]));
      dirtyFields = dirtyFields.filter((key) => !namespaceIds.has(Number(key.split(':', 1)[0])));
      toast.success('provisioning.namespace.save.success');
    } catch {
      toast.error('provisioning.namespace.save.failed');
    } finally {
      busy = false;
      stage = undefined;
    }
  }

  async function revertNamespace(): Promise<void> {
    if (!client || !loaded || busy || (activeDirtyFieldCount === 0 && activeFirmwareDraftCount === 0)) return;
    const activeClient = client;
    const activeLoaded = loaded;
    const namespaceIds = Array.from(activeNamespaceIds);
    busy = true;
    try {
      await activeClient.discard(namespaceIds);
      const nextState = await activeClient.getState(namespaceIds);
      const refreshedState = refreshedNamespaceState(namespaceIds, nextState);
      const retainedDrafts = Object.fromEntries(Object.entries(activeLoaded.drafts ?? {})
        .filter(([namespaceId]) => !activeNamespaceIds.has(Number(namespaceId))));
      loaded = {
        ...activeLoaded,
        state: { ...activeLoaded.state, ...refreshedState },
        drafts: retainedDrafts,
      };
      draft = { ...draft, ...refreshedState };
      dirtyFields = dirtyFields.filter((key) => !activeNamespaceIds.has(Number(key.split(':', 1)[0])));
      firmwareDraftFields = firmwareDraftFields.filter((key) => !activeNamespaceIds.has(Number(key.split(':', 1)[0])));
      toast.success('provisioning.namespace.revert.success');
    } catch {
      toast.error('provisioning.namespace.revert.failed');
    } finally {
      busy = false;
      stage = undefined;
    }
  }

  async function commitAll(): Promise<void> {
    if (!client || !loaded || busy || firmwareDraftFields.length === 0) return;
    const activeClient = client;
    const activeLoaded = loaded;
    const namespaceIds = activeLoaded.schema.namespaces.map((namespace) => namespace.id);
    busy = true;
    try {
      const result = await activeClient.commit();
      const nextState = await activeClient.getState(namespaceIds);
      const refreshedState = refreshedNamespaceState(namespaceIds, nextState);
      loaded = {
        ...activeLoaded,
        info: { ...activeLoaded.info, needsReboot: result.needsReboot },
        state: refreshedState,
        drafts: {},
      };
      draft = structuredClone(refreshedState);
      dirtyFields = [];
      firmwareDraftFields = [];
      toast.success(result.needsReboot
        ? 'provisioning.commitAll.rebootRequired'
        : 'provisioning.commitAll.success');
    } catch {
      toast.error('provisioning.commitAll.failed');
    } finally {
      busy = false;
      stage = undefined;
    }
  }

  async function discardAll(): Promise<void> {
    if (!client || !loaded || busy || firmwareDraftFields.length === 0) return;
    const activeClient = client;
    const activeLoaded = loaded;
    const namespaceIds = activeLoaded.schema.namespaces.map((namespace) => namespace.id);
    busy = true;
    try {
      await activeClient.discard();
      const nextState = await activeClient.getState(namespaceIds);
      const refreshedState = refreshedNamespaceState(namespaceIds, nextState);
      loaded = { ...activeLoaded, state: refreshedState, drafts: {} };
      draft = structuredClone(refreshedState);
      dirtyFields = [];
      firmwareDraftFields = [];
      toast.success('provisioning.discardAll.success');
    } catch {
      toast.error('provisioning.discardAll.failed');
    } finally {
      busy = false;
      stage = undefined;
    }
  }

  async function sendCommand(namespaceId: number, field: ProvisioningField): Promise<void> {
    if (!client || busy) return;
    const value = field.type === provisioningFieldTypes.void
      ? null
      : editableFieldValue(namespaceId, field);
    if (value === undefined) return;
    busy = true;
    try {
      const result = await client.save({ [namespaceId]: { [field.id]: value } }, [namespaceId]);
      commandValues = Object.fromEntries(Object.entries(commandValues)
        .filter(([key]) => key !== fieldKey(namespaceId, field.id)));
      toast.success(result.needsReboot ? 'provisioning.command.rebootRequired' : 'provisioning.command.success');
    } catch {
      toast.error('provisioning.command.failed');
    } finally {
      busy = false;
      stage = undefined;
    }
  }

  async function reboot(): Promise<void> {
    if (!client || busy) return;
    busy = true;
    try {
      await client.reboot();
      toast.success('provisioning.reboot.sent');
    } catch {
      toast.error('provisioning.reboot.failed');
    } finally {
      busy = false;
      stage = undefined;
    }
  }

  async function factoryReset(): Promise<void> {
    if (!client || busy) return;
    busy = true;
    try {
      await client.factoryReset();
      toast.success('provisioning.factoryReset.sent');
    } catch {
      toast.error('provisioning.factoryReset.failed');
    } finally {
      busy = false;
      stage = undefined;
    }
  }

  function requestCommand(namespaceId: number, field: ProvisioningField): void {
    if (!client || busy) return;
    const value = field.type === provisioningFieldTypes.void
      ? null
      : editableFieldValue(namespaceId, field);
    if (value !== undefined) confirmation = { kind: 'command', namespaceId, field };
  }

  async function confirmProvisioningAction(): Promise<void> {
    const pending = confirmation;
    if (!pending) return;
    if (pending.kind === 'commitAll') await commitAll();
    else if (pending.kind === 'discardAll') await discardAll();
    else if (pending.kind === 'command') await sendCommand(pending.namespaceId, pending.field);
    else if (pending.kind === 'reboot') await reboot();
    else await factoryReset();
    confirmation = undefined;
  }

  function displayValue(value: ProvisioningValue | undefined): string {
    if (value === undefined || value === null) return '—';
    if (value instanceof Uint8Array) return bytesToHex(value);
    if (Array.isArray(value)) return value.map((item) => displayValue(item)).join(', ');
    if (value instanceof Map) return '—';
    return String(value);
  }

  function displayListValue(value: ProvisioningValue | undefined): string {
    return Array.isArray(value)
      ? value.map((item) => {
        const bytes = byteArrayValue(item);
        return bytes ? bytesToHex(Uint8Array.from(bytes)) : displayValue(item);
      }).join('\n')
      : displayValue(value);
  }

  function parseBytes(value: string): Uint8Array {
    const normalized = value.replace(/[^0-9a-f]/gi, '');
    if (normalized.length % 2 !== 0) throw new Error('PROVISIONING_BYTES_INVALID');
    return Uint8Array.from({ length: normalized.length / 2 }, (_, index) => Number.parseInt(normalized.slice(index * 2, index * 2 + 2), 16));
  }

  function parseBytesList(value: string): ProvisioningValue[] {
    return value.split(/[,\n]/).map((item) => item.trim()).filter(Boolean).map(parseBytes);
  }

  function bytesToHex(value: Uint8Array): string {
    return Array.from(value, (byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  function stageLabel(): string {
    switch (stage) {
      case 'findingPath': return $t('provisioning.stage.findingPath');
      case 'establishingLink': return $t('provisioning.stage.establishingLink');
      case 'identifying': return $t('provisioning.stage.identifying');
      case 'requesting': return $t('provisioning.stage.requesting');
      case 'receiving': return $t('provisioning.stage.receiving');
      default: return $t('common.loading');
    }
  }
</script>

<div class="page provisioning-page">
  <header class="page-header provisioning-header">
    <button class="button secondary compact provisioning-back-button" type="button" onclick={() => navigateBack('tools')}>
      <Icon name="arrow-left" size={16} />{$t('provisioning.backToTools')}
    </button>
    <div class="provisioning-header-copy">
      <p class="eyebrow">{$t('app.name')}</p>
      <h1>{selectedNode && nodeName(selectedNode)
        ? $t('provisioning.title.connected', { name: nodeName(selectedNode) })
        : $t('provisioning.title')}</h1>
      <p>{$t('provisioning.description')}</p>
    </div>
  </header>

  <form
    class="provisioning-address"
    class:connection-active={Boolean(selectedNode)}
    onsubmit={connectToDestination}
  >
    <div class="provisioning-address-actions" role="group" aria-label={$t('provisioning.destination.actions.toolbar')}>
      <button
        class="icon-button"
        type="button"
        aria-label={$t(loadingDevice ? 'provisioning.connection.cancel' : 'provisioning.connection.disconnect')}
        title={$t(loadingDevice ? 'provisioning.connection.cancel' : 'provisioning.connection.disconnect')}
        disabled={!selectedNode || (busy && !loadingDevice)}
        onclick={disconnectDevice}
      ><Icon name="close" size={19} /></button>
      <button
        class="icon-button"
        type="button"
        aria-label={$t('provisioning.refresh')}
        title={$t('provisioning.refresh')}
        disabled={!selectedNode || busy}
        onclick={() => void refreshActiveSection()}
      ><Icon name="sync" size={19} /></button>
    </div>
    <div class="provisioning-address-field">
      <label class:connection-locked={Boolean(selectedNode)}>
        <span class="sr-only">{$t('provisioning.destination.label')}</span>
        <Icon name="network" size={19} />
        <input
          bind:value={managementDestination}
          placeholder={$t('provisioning.destination.placeholder')}
          autocapitalize="none"
          spellcheck="false"
          disabled={Boolean(selectedNode)}
        />
      </label>
      {#if selectedNode}
        <button
          class="provisioning-address-copy-target"
          type="button"
          aria-label={$t('provisioning.bookmark.copyAddress')}
          title={$t('provisioning.bookmark.copyAddress')}
          onclick={copyActiveDestination}
        ></button>
      {/if}
    </div>
    {#if !selectedNode}
      <button class="button primary" type="submit" disabled={!normalizedDestination}>
        {$t('provisioning.connect')}<Icon name="arrow-right" size={17} />
      </button>
    {:else if loaded}
      <select
        class="provisioning-section-select"
        aria-label={$t('provisioning.section.label')}
        bind:value={activeSection}
        disabled={busy}
      >
        <option value="status">{$t('provisioning.section.status')}</option>
        {#each rootNamespaces as namespace (namespace.id)}
          <option value={`namespace:${namespace.id}`}>{namespace.name}</option>
        {/each}
      </select>
    {/if}
    {#if selectedNode && loaded && firmwareDraftFields.length > 0}
      <section class="provisioning-pending-bar">
        <span>{$t('provisioning.pending.count', { count: firmwareDraftFields.length })}</span>
        <div>
          <button class="button secondary compact" type="button" onclick={() => { confirmation = { kind: 'discardAll' }; }}>
            {$t('provisioning.discardAll')}
          </button>
          <button class="button primary compact" type="button" onclick={() => { confirmation = { kind: 'commitAll' }; }}>
            {$t('provisioning.commitAll')}
          </button>
        </div>
      </section>
    {/if}
  </form>

  <div class="provisioning-workspace" class:sectioned={Boolean(selectedNode && loaded)}>
    {#if !selectedNode}
      <aside class="provisioning-directory">
        <label class="search-field">
          <Icon name="search" size={18} />
          <span class="sr-only">{$t('provisioning.search.label')}</span>
          <input
            bind:value={query}
            type="search"
            placeholder={$t('provisioning.search.placeholder')}
          />
        </label>
        <div
          id="provisioning-destination-results"
          class="provisioning-directory-content"
          class:empty={!bookmarkedNodes.length && !announcedNodes.length}
        >
        {#if bookmarkedNodes.length}
          <section class="provisioning-directory-section">
            <h2>{$t('provisioning.bookmarks.title')}</h2>
            <div class="provisioning-node-list">
              {#each bookmarkedNodes as node (node.id)}
                <button
                  class="nomad-destination"
                  aria-haspopup="menu"
                  title={$t('provisioning.destination.actions.open')}
                  onclick={() => void selectNode(node)}
                  use:contextMenuTrigger={{
                    onopen: (x, y, method) => openDestinationActions(node, x, y, method),
                  }}
                >
                  <span class="destination-mark"><Icon name="bookmark" size={17} /></span>
                  <span>
                    {#if node.label}<strong>{node.label}</strong>{/if}
                    <code>{node.destinationHash}</code>
                    {#if node.lastAnnouncedAt}
                      <small>{$t('provisioning.node.lastHeard', { date: heardAtFormatter.format(new Date(node.lastAnnouncedAt)) })}</small>
                    {/if}
                  </span>
                  <span class="directory-row-route">
                    <PathStatus status={$destinationPathStatuses[node.destinationHash]} />
                    <Icon name="arrow-right" size={16} />
                  </span>
                </button>
              {/each}
            </div>
          </section>
        {/if}

        {#if announcedNodes.length}
          <section class="provisioning-directory-section">
            <h2>{$t('provisioning.announced.title')}</h2>
            <div class="provisioning-node-list">
              {#each announcedNodes as node (node.id)}
                <button
                  class="nomad-destination"
                  aria-haspopup="menu"
                  title={$t('provisioning.destination.actions.open')}
                  onclick={() => void selectNode(node)}
                  use:contextMenuTrigger={{
                    onopen: (x, y, method) => openDestinationActions(node, x, y, method),
                  }}
                >
                  <span class="destination-mark"><Icon name="network" size={17} /></span>
                  <span>
                    {#if nodeName(node)}<strong>{nodeName(node)}</strong>{/if}
                    <code>{node.destinationHash}</code>
                    {#if node.lastAnnouncedAt}
                      <small>{$t('provisioning.node.lastHeard', { date: heardAtFormatter.format(new Date(node.lastAnnouncedAt)) })}</small>
                    {/if}
                  </span>
                  <span class="directory-row-route">
                    <PathStatus status={$destinationPathStatuses[node.destinationHash]} />
                    <Icon name="arrow-right" size={16} />
                  </span>
                </button>
              {/each}
            </div>
          </section>
        {/if}

        {#if !bookmarkedNodes.length && !announcedNodes.length}
          <EmptyState icon="network" title={$t('provisioning.nodes.empty.title')} body={$t('provisioning.nodes.empty.description')} />
        {/if}
        </div>
      </aside>
    {:else}
      {#if loaded}
        <nav class="provisioning-section-navigation" aria-label={$t('provisioning.section.label')}>
          <div class="provisioning-section-navigation-list">
            <button
              class:active={activeSection === 'status'}
              type="button"
              aria-current={activeSection === 'status' ? 'page' : undefined}
              disabled={busy}
              onclick={() => activeSection = 'status'}
            >
              <span class="destination-mark provisioning-section-icon" data-icon="info">
                <Icon name="info" size={16} />
              </span>
              <span>{$t('provisioning.section.status')}</span>
            </button>
            {#each rootNamespaces as namespace (namespace.id)}
              {@const readOnlySection = namespaceIsReadOnly(namespace.id)}
              <button
                class:active={activeSection === `namespace:${namespace.id}`}
                type="button"
                aria-current={activeSection === `namespace:${namespace.id}` ? 'page' : undefined}
                disabled={busy}
                onclick={() => activeSection = `namespace:${namespace.id}`}
              >
                <span
                  class="destination-mark provisioning-section-icon"
                  class:read-only={readOnlySection}
                  data-icon={readOnlySection ? 'info' : 'settings'}
                >
                  <Icon name={readOnlySection ? 'info' : 'settings'} size={16} />
                </span>
                <span>{namespace.name}</span>
              </button>
            {/each}
          </div>
        </nav>
      {/if}
      <section class:device-loaded={Boolean(loaded) && !busy} class="provisioning-editor-card">
      <div class="provisioning-grid" aria-hidden="true"></div>
      {#if busy}
        <div class="provisioning-loading">
          <span class="loading-spinner" aria-hidden="true"></span>
          <strong>{stageLabel()}</strong>
          {#if transferProgress !== undefined}
            <progress max="1" value={transferProgress}></progress>
            <small>{Math.round(transferProgress * 100)}%{transferSize ? ` · ${Math.ceil(transferSize / 1_000)} KB` : ''}</small>
          {/if}
        </div>
      {:else if loaded}
        {#if activeSection === 'status'}
          <div class="provisioning-namespace-list provisioning-status-list">
            <section class="provisioning-status-section">
              <h3>{$t('provisioning.section.status')}</h3>
              <dl class="provisioning-status-grid">
                <div>
                  <dt>{$t('provisioning.info.destination')}</dt>
                  <dd><code>{selectedNode.destinationHash}</code></dd>
                </div>
                <div>
                  <dt>{$t('provisioning.info.firmware')}</dt>
                  <dd>{loaded.info.firmwareVersion ?? $t('provisioning.info.unknownFirmware')}</dd>
                </div>
                <div>
                  <dt>{$t('provisioning.info.schema')}</dt>
                  <dd>{loaded.info.schemaVersion ?? '—'}</dd>
                </div>
                <div>
                  <dt>{$t('provisioning.info.rebootRequired')}</dt>
                  <dd>
                    {#if loaded.info.needsReboot}
                      <span class="badge experimental">{$t('provisioning.info.yes')}</span>
                    {:else}
                      <span class="badge success">{$t('provisioning.info.no')}</span>
                    {/if}
                  </dd>
                </div>
                <div>
                  <dt>{$t('provisioning.info.pendingChanges')}</dt>
                  <dd class="provisioning-pending-summary">
                    {#if firmwareDraftFields.length === 0 && dirtyFields.length === 0}
                      <span class="badge success">{$t('provisioning.info.pendingNone')}</span>
                    {:else}
                      <span class="badge experimental">{$t('provisioning.info.pendingSaved', { count: firmwareDraftFields.length })}</span>
                      <span class="badge experimental">{$t('provisioning.info.pendingUnsaved', { count: dirtyFields.length })}</span>
                    {/if}
                  </dd>
                </div>
              </dl>
              <div class="provisioning-status-actions">
                <button
                  class="button secondary compact danger-text"
                  type="button"
                  onclick={() => { confirmation = { kind: 'factoryReset' }; }}
                >{$t('provisioning.factoryReset')}</button>
                <button
                  class="button secondary compact"
                  type="button"
                  onclick={() => { confirmation = { kind: 'reboot' }; }}
                ><Icon name="sync" size={16} />{$t('provisioning.reboot')}</button>
              </div>
            </section>
          </div>
        {:else}
        <div class="provisioning-namespace-list">
          {#each visibleNamespaces as namespace (namespace.id)}
            {@const depth = Math.min(namespaceDepth(namespace.id), 3)}
            <section
              class="provisioning-namespace-section"
              class:depth-0={depth === 0}
              class:depth-1={depth === 1}
              class:depth-2={depth === 2}
              class:depth-3={depth >= 3}
            >
              {#if depth === 1}
                <h2 id={`provisioning-namespace-${namespace.id}`}>{namespace.name}</h2>
              {:else if depth === 2}
                <h3 id={`provisioning-namespace-${namespace.id}`}>{namespace.name}</h3>
              {:else if depth >= 3}
                <h4 id={`provisioning-namespace-${namespace.id}`}>{namespace.name}</h4>
              {/if}
              {#if namespace.fields.length > 0}
              <div
                class="provisioning-namespace-fields"
                role="group"
                aria-label={depth === 0 ? namespace.name : undefined}
                aria-labelledby={depth === 0 ? undefined : `provisioning-namespace-${namespace.id}`}
              >
                <div class="provisioning-field-grid">
                {#each namespace.fields as field (field.id)}
                  <label class="field provisioning-field" class:read-only={fieldIsReadOnly(field)}>
                    <span>
                      {field.name}
                      {#if (field.flags & provisioningFieldFlags.rebootRequired) !== 0}<small>{$t('provisioning.field.reboot')}</small>{/if}
                    </span>
                    {#if fieldIsReadOnly(field)}
                      <output>{displayValue(fieldValue(namespace.id, field))}</output>
                    {:else if field.type === provisioningFieldTypes.boolean}
                      <span class="toggle-row compact-toggle">
                        <span><small>{editableFieldValue(namespace.id, field) === true ? $t('provisioning.value.enabled') : $t('provisioning.value.disabled')}</small></span>
                        <input type="checkbox" role="switch" checked={editableFieldValue(namespace.id, field) === true} onchange={(event) => updateEditableField(namespace.id, field, event.currentTarget.checked)} />
                      </span>
                    {:else if field.type === provisioningFieldTypes.enumeration}
                      <select value={displayValue(editableFieldValue(namespace.id, field))} onchange={(event) => {
                        const index = field.enumValues?.findIndex((value) => displayValue(value) === event.currentTarget.value) ?? -1;
                        if (index >= 0) updateEditableField(namespace.id, field, field.enumValues![index]);
                      }}>
                        {#each field.enumValues ?? [] as value, index}
                          <option value={displayValue(value)}>{field.enumLabels?.[index] ?? displayValue(value)}</option>
                        {/each}
                      </select>
                    {:else if field.type === provisioningFieldTypes.integer || field.type === provisioningFieldTypes.float}
                      <input
                        type="number"
                        min={field.type === provisioningFieldTypes.integer ? field.minInteger : field.minFloat}
                        max={field.type === provisioningFieldTypes.integer ? field.maxInteger : field.maxFloat}
                        step={field.type === provisioningFieldTypes.integer ? 1 : 'any'}
                        value={Number(editableFieldValue(namespace.id, field) ?? 0)}
                        oninput={(event) => {
                          if (Number.isFinite(event.currentTarget.valueAsNumber)) {
                            updateEditableField(namespace.id, field, event.currentTarget.valueAsNumber);
                          }
                        }}
                      />
                    {:else if field.type === provisioningFieldTypes.bytes}
                      <input value={displayValue(editableFieldValue(namespace.id, field))} oninput={(event) => {
                        try { updateEditableField(namespace.id, field, parseBytes(event.currentTarget.value)); }
                        catch { /* Wait for a complete byte pair before updating the draft. */ }
                      }} onchange={(event) => {
                        try { updateEditableField(namespace.id, field, parseBytes(event.currentTarget.value)); }
                        catch { toast.error('provisioning.field.bytesInvalid'); }
                      }} />
                    {:else if field.type === provisioningFieldTypes.bytesList}
                      <textarea rows="3" value={displayListValue(editableFieldValue(namespace.id, field))} oninput={(event) => {
                        try { updateEditableField(namespace.id, field, parseBytesList(event.currentTarget.value)); }
                        catch { /* Wait for complete byte pairs before updating the draft. */ }
                      }} onchange={(event) => {
                        try { updateEditableField(namespace.id, field, parseBytesList(event.currentTarget.value)); }
                        catch { toast.error('provisioning.field.bytesInvalid'); }
                      }}></textarea>
                    {:else if field.type === provisioningFieldTypes.void}
                      <button class="button secondary compact" type="button" onclick={() => fieldIsWriteOnly(field)
                        ? requestCommand(namespace.id, field)
                        : updateField(namespace.id, field, null)}>{$t('provisioning.field.trigger')}</button>
                    {:else}
                      <input
                        type={fieldIsSecret(field) ? 'password' : 'text'}
                        maxlength={field.maxLength}
                        value={typeof editableFieldValue(namespace.id, field) === 'string' ? editableFieldValue(namespace.id, field) as string : ''}
                        placeholder={fieldIsSecret(field) ? $t('provisioning.field.secretPlaceholder') : undefined}
                        oninput={(event) => updateEditableField(namespace.id, field, event.currentTarget.value)}
                      />
                    {/if}
                    {#if fieldIsWriteOnly(field) && field.type !== provisioningFieldTypes.void}
                      <button class="button secondary compact provisioning-command-button" type="button" onclick={() => requestCommand(namespace.id, field)}>
                        {$t('provisioning.command.send')}
                      </button>
                    {/if}
                  </label>
                {/each}
                </div>
              </div>
              {/if}
            </section>
          {/each}
          <div class="provisioning-status-actions provisioning-namespace-actions">
            <button
              class="button secondary compact"
              type="button"
              disabled={activeDirtyFieldCount === 0 && activeFirmwareDraftCount === 0}
              onclick={() => void revertNamespace()}
            >{$t('provisioning.namespace.revert')}</button>
            <button
              class="button primary compact"
              type="button"
              disabled={activeDirtyFieldCount === 0}
              onclick={() => void saveNamespace()}
            >{$t('provisioning.namespace.save')}</button>
          </div>
        </div>
        {/if}

      {:else}
        <EmptyState icon="network" title={$t('provisioning.load.empty.title')} body={$t('provisioning.load.empty.description')} />
      {/if}
      </section>
    {/if}
  </div>
</div>

{#if bookmarkEditor}
  <BookmarkEditor
    address={bookmarkEditor.node.destinationHash}
    title={$t(bookmarkEditor.mode === 'add'
      ? 'provisioning.bookmark.editor.addTitle'
      : 'provisioning.bookmark.editor.editTitle')}
    description={$t('provisioning.bookmark.editor.description')}
    addressLabel={$t('provisioning.destination.label')}
    copyAddressLabel={$t('provisioning.bookmark.copyAddress')}
    nameLabel={$t('nomadnet.bookmark.name')}
    namePlaceholder={$t('provisioning.bookmark.name.placeholder')}
    nameHelp={$t('nomadnet.bookmark.name.help')}
    saveErrorKey="provisioning.bookmark.failed"
    currentName={bookmarkEditor.node.label ?? ''}
    oncancel={() => { bookmarkEditor = undefined; }}
    onsave={(_address, name) => saveBookmark(name)}
  />
{/if}

{#if confirmation}
  <ConfirmationDialog
    titleId="provisioning-confirmation-title"
    title={$t(confirmation.kind === 'commitAll'
      ? 'provisioning.commitAll'
      : confirmation.kind === 'discardAll'
        ? 'provisioning.discardAll'
        : confirmation.kind === 'command'
          ? 'provisioning.command.dialog.title'
          : confirmation.kind === 'reboot'
            ? 'provisioning.reboot'
            : 'provisioning.factoryReset')}
    description={$t(confirmation.kind === 'commitAll'
      ? 'provisioning.commitAll.confirm'
      : confirmation.kind === 'discardAll'
        ? 'provisioning.discardAll.confirm'
        : confirmation.kind === 'command'
          ? 'provisioning.command.confirm'
          : confirmation.kind === 'reboot'
            ? 'provisioning.reboot.confirm'
            : 'provisioning.factoryReset.confirm', confirmation.kind === 'command'
              ? { name: confirmation.field.name }
              : undefined)}
    icon={confirmation.kind === 'commitAll' ? 'check'
      : confirmation.kind === 'command' ? 'send'
        : confirmation.kind === 'reboot' ? 'sync' : 'trash'}
    tone={confirmation.kind === 'discardAll' || confirmation.kind === 'factoryReset' ? 'danger' : 'primary'}
    confirmLabel={$t(confirmation.kind === 'commitAll'
      ? 'provisioning.commitAll'
      : confirmation.kind === 'discardAll'
        ? 'provisioning.discardAll'
        : confirmation.kind === 'command'
          ? 'provisioning.command.send'
          : confirmation.kind === 'reboot'
            ? 'provisioning.reboot'
            : 'provisioning.factoryReset')}
    oncancel={() => { confirmation = undefined; }}
    onconfirm={confirmProvisioningAction}
  />
{/if}

{#if destinationActions}
  <ContextMenu
    x={destinationActions.x}
    y={destinationActions.y}
    autofocus={destinationActions.autofocus}
    guardOpeningRelease={destinationActions.guardOpeningRelease}
    label={$t('provisioning.destination.actions.label')}
    closeLabel={$t('provisioning.destination.actions.close')}
    onclose={closeDestinationActions}
  >
    <button
      role="menuitem"
      onclick={() => { void copyDestinationHash(destinationActions!.node.destinationHash); }}
    >
      <Icon name="copy" size={17} />{$t('nomadnet.destination.actions.copyHash')}
    </button>
    <button
      role="menuitem"
      disabled={$pendingProbeDestinationHashes.has(destinationActions.node.destinationHash)}
      onclick={() => { probeDestination(destinationActions!.node); }}
    >
      <Icon name="probe" size={17} />{$t('provisioning.destination.actions.probe')}
    </button>
    {#if destinationActions.node.bookmarked}
      <button
        role="menuitem"
        onclick={() => {
          const node = destinationActions!.node;
          closeDestinationActions();
          editBookmark(node);
        }}
      >
        <Icon name="edit" size={17} />{$t('nomadnet.destination.actions.editBookmark')}
      </button>
      <button
        class="danger"
        role="menuitem"
        onclick={() => {
          const node = destinationActions!.node;
          closeDestinationActions();
          void removeBookmark(node);
        }}
      >
        <Icon name="trash" size={17} />{$t('nomadnet.destination.actions.removeBookmark')}
      </button>
    {:else}
      <button
        role="menuitem"
        onclick={() => {
          const node = destinationActions!.node;
          closeDestinationActions();
          editBookmark(node);
        }}
      >
        <Icon name="bookmark" size={17} />{$t('nomadnet.destination.actions.addBookmark')}
      </button>
    {/if}
  </ContextMenu>
{/if}
