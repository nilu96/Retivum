<script lang="ts">
  import { onDestroy } from 'svelte';
  import { navigate } from '../../app/router';
  import type { LoadedProvisioningDevice } from '../../infrastructure/reticulum/provisioning-client';
  import type {
    ProvisioningField,
    ProvisioningNode,
    ProvisioningState,
    ProvisioningValue,
  } from '../../domain/provisioning';
  import { provisioningFieldFlags, provisioningFieldTypes } from '../../domain/provisioning';
  import { normalizeDestinationHash } from '../../domain/settings';
  import { ProvisioningClient } from '../../infrastructure/reticulum/provisioning-client';
  import { pendingProbeDestinationHashes } from '../../infrastructure/reticulum/probe-operations';
  import { probeTimeoutMsForPath } from '../../infrastructure/reticulum/timeouts';
  import { destinationPathStatuses, nomadAnnounces, provisioningNodes, reticulumRuntime } from '../../infrastructure/reticulum/runtime';
  import { createDateFormatter, locale, t } from '../../i18n';
  import { contextMenuTrigger } from '../../lib/actions/contextMenuTrigger';
  import { copyText } from '../../lib/clipboard';
  import BookmarkEditor from '../../lib/components/BookmarkEditor.svelte';
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
  let busy = $state(false);
  let loadingDevice = $state(false);
  let stage = $state<string>();
  let transferProgress = $state<number>();
  let transferSize = $state<number>();
  let managementDestination = $state('');
  let query = $state('');
  let selectedNodeSnapshot = $state<ProvisioningNode>();
  let bookmarkEditor = $state<{ node: ProvisioningNode; mode: 'add' | 'edit' }>();
  let destinationActions = $state<{ node: ProvisioningNode; x: number; y: number }>();
  let loadSequence = 0;
  const heardAtFormatter = $derived(createDateFormatter($locale));
  const selectedNode = $derived(
    $provisioningNodes.find((node) => node.id === selectedNodeId)
      ?? (selectedNodeSnapshot?.id === selectedNodeId ? selectedNodeSnapshot : undefined),
  );
  const destinationNode = $derived($provisioningNodes.find((node) => (
    node.destinationHash === managementDestination.trim().toLowerCase()
  )));
  const normalizedQuery = $derived(query.trim().toLowerCase());
  const filteredNodes = $derived($provisioningNodes.filter((node) => [
    nodeName(node),
    node.label,
    node.destinationHash,
  ].some((value) => value?.toLowerCase().includes(normalizedQuery))));
  const bookmarkedNodes = $derived(filteredNodes.filter((node) => node.bookmarked === true));
  const announcedNodes = $derived(filteredNodes.filter((node) => node.bookmarked !== true));
  const normalizedDestination = $derived(normalizeDestinationHash(managementDestination));

  onDestroy(() => {
    loadSequence += 1;
    reticulumRuntime.closeProvisioning();
  });

  function nodeName(node: ProvisioningNode): string {
    if (node.bookmarked) return node.label ?? '';
    return node.label
      ?? announcedNodeName(node)
      ?? '';
  }

  function announcedNodeName(node: ProvisioningNode): string | undefined {
    return $nomadAnnounces.find((announce) => announce.publicKey === node.publicKey)?.displayName;
  }

  async function selectNode(node: ProvisioningNode): Promise<void> {
    if (selectedNode || client || busy) return;
    if (selectedNodeId !== node.id) {
      loaded = undefined;
      draft = {};
      commandValues = {};
      dirtyFields = [];
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
      publicKey: '',
      heardAt: new Date().toISOString(),
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

  function openDestinationActions(node: ProvisioningNode, x: number, y: number): void {
    destinationActions = { node, x, y };
  }

  function closeDestinationActions(): void {
    destinationActions = undefined;
  }

  async function copyDestinationHash(destinationHash: string): Promise<void> {
    closeDestinationActions();
    if (await copyText(destinationHash)) toast.success('common.copied');
    else toast.error('common.copyFailed');
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
      draft = structuredClone(nextLoaded.state);
      dirtyFields = [];
      stage = undefined;
    } catch {
      if (sequence !== loadSequence || client !== activeClient) return;
      stage = undefined;
      toast.error('provisioning.load.failed');
    } finally {
      if (sequence === loadSequence && client === activeClient) {
        busy = false;
        loadingDevice = false;
      }
    }
  }

  function reloadDevice(): void {
    if (!selectedNode || !client || busy) return;
    void loadDevice();
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
    busy = false;
    loadingDevice = false;
    stage = undefined;
    transferProgress = undefined;
    transferSize = undefined;
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
    if (!dirtyFields.includes(key)) dirtyFields = [...dirtyFields, key];
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

  function editableState(): ProvisioningState {
    const result: ProvisioningState = {};
    for (const key of dirtyFields) {
      const [namespaceId, fieldId] = key.split(':').map(Number);
      const value = draft[namespaceId]?.[fieldId];
      if (value === undefined) continue;
      result[namespaceId] = { ...(result[namespaceId] ?? {}), [fieldId]: value };
    }
    return result;
  }

  async function save(): Promise<void> {
    if (!client || busy || dirtyFields.length === 0) return;
    busy = true;
    try {
      const changedNamespaces = Array.from(new Set(dirtyFields.map((key) => Number(key.split(':', 1)[0]))));
      const result = await client.save(editableState(), changedNamespaces);
      toast.success(result.needsReboot ? 'provisioning.save.rebootRequired' : 'provisioning.save.success');
      loaded = await client.load();
      draft = structuredClone(loaded.state);
      dirtyFields = [];
    } catch {
      toast.error('provisioning.save.failed');
    } finally {
      busy = false;
      stage = undefined;
    }
  }

  async function discard(): Promise<void> {
    if (!client || busy) return;
    busy = true;
    try {
      await client.discard();
      loaded = await client.load();
      draft = structuredClone(loaded.state);
      dirtyFields = [];
      toast.success('provisioning.discard.success');
    } catch {
      toast.error('provisioning.discard.failed');
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
    if (value === undefined || !window.confirm($t('provisioning.command.confirm', { name: field.name }))) return;
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
    if (!client || busy || !window.confirm($t('provisioning.reboot.confirm'))) return;
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
    if (!client || busy || !window.confirm($t('provisioning.factoryReset.confirm'))) return;
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

  function displayValue(value: ProvisioningValue | undefined): string {
    if (value === undefined || value === null) return '—';
    if (value instanceof Uint8Array) return bytesToHex(value);
    if (Array.isArray(value)) return value.map((item) => displayValue(item)).join(', ');
    if (value instanceof Map) return '—';
    return String(value);
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
    <button class="button secondary compact provisioning-back-button" type="button" onclick={() => navigate('tools')}>
      <Icon name="arrow-left" size={16} />{$t('provisioning.backToTools')}
    </button>
    <div class="provisioning-header-copy">
      <p class="eyebrow">{$t('app.name')}</p>
      <h1>{$t('provisioning.title')}</h1>
      <p>{$t('provisioning.description')}</p>
    </div>
  </header>

  <form class="provisioning-address" onsubmit={connectToDestination}>
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
        onclick={reloadDevice}
      ><Icon name="sync" size={19} /></button>
    </div>
    <label>
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
    <button class="button primary" type="submit" disabled={!normalizedDestination || Boolean(selectedNode)}>
      {$t(loadingDevice ? 'provisioning.connecting' : 'provisioning.connect')}<Icon name="arrow-right" size={17} />
    </button>
  </form>

  <div class="provisioning-workspace">
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
        <div id="provisioning-destination-results" class="provisioning-directory-content">
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
                    onopen: (x, y) => openDestinationActions(node, x, y),
                  }}
                >
                  <span class="destination-mark"><Icon name="bookmark" size={17} /></span>
                  <span>
                    {#if node.label}<strong>{node.label}</strong>{/if}
                    <code>{node.destinationHash}</code>
                    <small>{$t('provisioning.node.lastHeard', { date: heardAtFormatter.format(new Date(node.heardAt)) })}</small>
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
                    onopen: (x, y) => openDestinationActions(node, x, y),
                  }}
                >
                  <span class="destination-mark"><Icon name="network" size={17} /></span>
                  <span>
                    {#if nodeName(node)}<strong>{nodeName(node)}</strong>{/if}
                    <code>{node.destinationHash}</code>
                    <small>{$t('provisioning.node.lastHeard', { date: heardAtFormatter.format(new Date(node.heardAt)) })}</small>
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
      <section class:device-loaded={Boolean(loaded) && !busy} class="provisioning-editor-card">
      <div class="provisioning-grid" aria-hidden="true"></div>
      {#if busy}
        <div class="provisioning-loading">
          <span class="loading-spinner" aria-hidden="true"></span>
          <strong>{stageLabel()}</strong>
          {#if transferProgress !== undefined}
            <progress max="1" value={transferProgress}></progress>
            <small>{Math.round(transferProgress * 100)}%{transferSize ? ` · ${Math.ceil(transferSize / 1024)} KiB` : ''}</small>
          {/if}
        </div>
      {:else if loaded}
        <header class="provisioning-device-header">
          <div>
            <h2>{nodeName(selectedNode)}</h2>
            <p>{loaded.info.firmwareVersion ?? $t('provisioning.info.unknownFirmware')}</p>
          </div>
        </header>

        <div class="provisioning-info-row">
          <span>{$t('provisioning.info.schemaVersion', { version: loaded.info.schemaVersion ?? '—' })}</span>
          {#if loaded.info.needsReboot}<span class="badge experimental">{$t('provisioning.info.rebootRequired')}</span>{/if}
        </div>

        <div class="provisioning-namespace-list">
          {#each loaded.schema.namespaces as namespace (namespace.id)}
            <fieldset class="provisioning-namespace">
              <legend>{namespace.name}</legend>
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
                        onchange={(event) => updateEditableField(namespace.id, field, event.currentTarget.valueAsNumber)}
                      />
                    {:else if field.type === provisioningFieldTypes.bytes}
                      <input value={displayValue(editableFieldValue(namespace.id, field))} onchange={(event) => {
                        try { updateEditableField(namespace.id, field, parseBytes(event.currentTarget.value)); }
                        catch { toast.error('provisioning.field.bytesInvalid'); }
                      }} />
                    {:else if field.type === provisioningFieldTypes.bytesList}
                      <textarea rows="3" value={displayValue(editableFieldValue(namespace.id, field))} onchange={(event) => {
                        try { updateEditableField(namespace.id, field, parseBytesList(event.currentTarget.value)); }
                        catch { toast.error('provisioning.field.bytesInvalid'); }
                      }}></textarea>
                    {:else if field.type === provisioningFieldTypes.void}
                      <button class="button secondary compact" type="button" onclick={() => fieldIsWriteOnly(field)
                        ? void sendCommand(namespace.id, field)
                        : updateField(namespace.id, field, null)}>{$t('provisioning.field.trigger')}</button>
                    {:else}
                      <input
                        type={fieldIsSecret(field) ? 'password' : 'text'}
                        maxlength={field.maxLength}
                        value={typeof editableFieldValue(namespace.id, field) === 'string' ? editableFieldValue(namespace.id, field) as string : ''}
                        placeholder={fieldIsSecret(field) ? $t('provisioning.field.secretPlaceholder') : undefined}
                        onchange={(event) => updateEditableField(namespace.id, field, event.currentTarget.value)}
                      />
                    {/if}
                    {#if fieldIsWriteOnly(field) && field.type !== provisioningFieldTypes.void}
                      <button class="button secondary compact provisioning-command-button" type="button" onclick={() => void sendCommand(namespace.id, field)}>
                        {$t('provisioning.command.send')}
                      </button>
                    {/if}
                  </label>
                {/each}
              </div>
            </fieldset>
          {/each}
        </div>

        <footer class="provisioning-actions">
          <div>
            <button class="button secondary compact danger-text" onclick={() => void factoryReset()}>{$t('provisioning.factoryReset')}</button>
            <button class="button secondary compact" onclick={() => void reboot()}>{$t('provisioning.reboot')}</button>
          </div>
          <div>
            <button class="button secondary compact" disabled={dirtyFields.length === 0} onclick={() => void discard()}>{$t('provisioning.discard')}</button>
            <button class="button primary compact" disabled={dirtyFields.length === 0} onclick={() => void save()}>{$t('common.save')}</button>
          </div>
        </footer>
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
    nameLabel={$t('nomadnet.bookmark.name')}
    namePlaceholder={$t('provisioning.bookmark.name.placeholder')}
    nameHelp={$t('nomadnet.bookmark.name.help')}
    saveErrorKey="provisioning.bookmark.failed"
    currentName={bookmarkEditor.node.label ?? ''}
    oncancel={() => { bookmarkEditor = undefined; }}
    onsave={(name) => saveBookmark(name)}
  />
{/if}

{#if destinationActions}
  <ContextMenu
    x={destinationActions.x}
    y={destinationActions.y}
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
