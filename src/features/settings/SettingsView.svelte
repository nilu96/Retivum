<script lang="ts">
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { requestedSettingsSection } from '../../app/router';
  import { parseIdentityFile, type IdentitySummary } from '../../domain/identity';
  import {
    defaultAppPreferences,
    AUTHORIZED_SERIAL_PORT_ID,
    interfaceDescription,
    normalizeDestinationHash,
    propagationIsActive,
    type AppPreferences,
    type InterfaceConfig,
    type InterfaceType,
    type LxmfDeliveryMethod,
    type PropagationSyncIntervalMinutes,
    type ThemePreference,
  } from '../../domain/settings';
  import { createDateFormatter, locale, t, type MessageKey } from '../../i18n';
  import { applyThemePreference } from '../../infrastructure/appearance/theme';
  import { detectInterfaceCapabilities, supportedInterfaceTypes } from '../../infrastructure/platform/interface-capabilities';
  import { BrowserSettingsRepository } from '../../infrastructure/database/settings-repository';
  import {
    activeIdentity,
    blockedChatDestinations,
    chatAnnounces,
    chatContacts,
    identities,
    interfaceStatuses,
    propagationNodeAnnounces,
    reticulumRuntime,
  } from '../../infrastructure/reticulum/runtime';
  import EmptyState from '../../lib/components/EmptyState.svelte';
  import Icon from '../../lib/components/Icon.svelte';
  import WebSocketInterfaceEditor from './WebSocketInterfaceEditor.svelte';
  import IdentityDeleteConfirmation from './IdentityDeleteConfirmation.svelte';
  import IdentityNameEditor from './IdentityNameEditor.svelte';
  import InterfaceTypePicker from './InterfaceTypePicker.svelte';
  import RNodeInterfaceEditor from './RNodeInterfaceEditor.svelte';
  import TcpInterfaceEditor from './TcpInterfaceEditor.svelte';
  import UdpInterfaceEditor from './UdpInterfaceEditor.svelte';
  import { toast } from '../../lib/notifications/toasts';

  const repository = new BrowserSettingsRepository();
  const interfaceCapabilities = detectInterfaceCapabilities();
  const availableInterfaceTypes = supportedInterfaceTypes(interfaceCapabilities);
  let preferences = $state<AppPreferences>(structuredClone(defaultAppPreferences));
  let interfaces = $state<InterfaceConfig[]>([]);
  let editorOpen = $state(false);
  let editorType = $state<InterfaceType>('websocket');
  let editorConfig = $state<InterfaceConfig | undefined>();
  let loading = $state(true);
  let identityNameEditorOpen = $state(false);
  let identityEditorMode = $state<'add' | 'edit'>('edit');
  let identityEditorTarget = $state<IdentitySummary | undefined>();
  let identityDeleteTarget = $state<IdentitySummary | undefined>();
  let identityBusyId = $state<string | undefined>();
  let interfaceBusyId = $state<string | undefined>();
  let blockedDestinationBusyHash = $state<string | undefined>();
  let blockedDestinationsExpanded = $state(false);
  let importInput = $state<HTMLInputElement>();
  let propagationNodeDraft = $state('');
  let propagationNodeInvalid = $state(false);
  let propagationNodeMenuOpen = $state(false);
  let propagationNodePicker = $state<HTMLDivElement>();
  const propagationHeardAtFormatter = $derived(createDateFormatter($locale));
  const blockedDestinationEntries = $derived($blockedChatDestinations.map((blocked) => ({
    ...blocked,
    name: $chatContacts.find((contact) => contact.destinationHash === blocked.destinationHash)?.name
      ?? $chatAnnounces.find((announce) => announce.destinationHash === blocked.destinationHash)?.displayName,
  })));
  const visibleBlockedDestinationEntries = $derived(
    blockedDestinationsExpanded ? blockedDestinationEntries : blockedDestinationEntries.slice(0, 2),
  );

  function localizedInterfaceDescription(config: InterfaceConfig): string {
    return interfaceDescription(
      config,
      config.type === 'rnode' && config.connection.deviceId === AUTHORIZED_SERIAL_PORT_ID
        ? $t('interface.editor.rnode.device.authorizedSerial')
        : undefined,
    );
  }

  onMount(async () => {
    try {
      const snapshot = await repository.load();
      preferences = snapshot.preferences;
      propagationNodeDraft = snapshot.preferences.lxmf.propagationNodeHash ?? '';
      interfaces = snapshot.interfaces;
      if (requestedSettingsSection() === 'interfaces') {
        requestAnimationFrame(() => document.getElementById('settings-interfaces')?.scrollIntoView({ block: 'start' }));
      }
    } catch {
      toast.error('settings.interfaces.loadError');
    } finally {
      loading = false;
    }
  });

  onMount(() => {
    const closeMenu = (event: PointerEvent) => {
      if (propagationNodeMenuOpen && propagationNodePicker && !propagationNodePicker.contains(event.target as Node)) {
        propagationNodeMenuOpen = false;
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') propagationNodeMenuOpen = false;
    };
    document.addEventListener('pointerdown', closeMenu);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeMenu);
      document.removeEventListener('keydown', closeOnEscape);
    };
  });

  $effect(() => {
    if (!loading) applyThemePreference(preferences.theme);
  });

  async function persistPreferences(): Promise<void> {
    try {
      await repository.savePreferences($state.snapshot(preferences));
      await reticulumRuntime.applyConfiguration($state.snapshot(preferences), $state.snapshot(interfaces));
    } catch {
      toast.error('settings.interfaces.saveError');
    }
  }

  function changeDeliveryMethod(method: LxmfDeliveryMethod): void {
    preferences.lxmf.defaultDeliveryMethod = method;
    if (method === 'propagated') preferences.lxmf.propagationEnabled = true;
    void persistPreferences();
  }

  function changeInboundStampCost(value: number): void {
    preferences.lxmf.inboundStampCost = Number.isInteger(value) && value >= 0 && value <= 254 ? value : 0;
    void persistPreferences();
  }

  async function saveInterface(config: InterfaceConfig): Promise<void> {
    if (hasEnabledBleDeviceConflict(config)) {
      toast.error('settings.interfaces.rnodeDeviceInUse');
      return;
    }
    try {
      await repository.saveInterface(config);
      const existingIndex = interfaces.findIndex((item) => item.id === config.id);
      interfaces = existingIndex === -1
        ? [...interfaces, config]
        : interfaces.map((item) => item.id === config.id ? config : item);
      await reticulumRuntime.applyConfiguration($state.snapshot(preferences), $state.snapshot(interfaces));
      editorOpen = false;
      editorConfig = undefined;
    } catch {
      toast.error('settings.interfaces.saveError');
    }
  }

  async function toggleInterface(config: InterfaceConfig): Promise<void> {
    if (interfaceBusyId) return;
    interfaceBusyId = config.id;
    const updated: InterfaceConfig = {
      ...$state.snapshot(config),
      enabled: !config.enabled,
    };
    if (hasEnabledBleDeviceConflict(updated)) {
      toast.error('settings.interfaces.rnodeDeviceInUse');
      interfaceBusyId = undefined;
      return;
    }
    try {
      await repository.saveInterface(updated);
      interfaces = interfaces.map((item) => item.id === updated.id ? updated : item);
      interfaceStatuses.update((statuses) => ({
        ...statuses,
        [updated.id]: updated.enabled ? 'connecting' : 'disabled',
      }));
      await reticulumRuntime.applyConfiguration($state.snapshot(preferences), $state.snapshot(interfaces));
    } catch {
      toast.error('settings.interfaces.saveError');
    } finally {
      interfaceBusyId = undefined;
    }
  }

  async function deleteInterface(config: InterfaceConfig): Promise<void> {
    try {
      await repository.deleteInterface(config.id);
      interfaces = interfaces.filter((item) => item.id !== config.id);
      await reticulumRuntime.applyConfiguration($state.snapshot(preferences), $state.snapshot(interfaces));
    } catch {
      toast.error('settings.interfaces.saveError');
    }
  }

  async function persistPropagationNode(): Promise<void> {
    const normalized = normalizeDestinationHash(propagationNodeDraft);
    if (propagationNodeDraft.trim() && !normalized) {
      propagationNodeInvalid = true;
      return;
    }
    propagationNodeInvalid = false;
    propagationNodeDraft = normalized ?? '';
    preferences.lxmf.propagationNodeHash = normalized;
    await persistPreferences();
  }

  function selectPropagationNode(destinationHash: string): void {
    propagationNodeDraft = destinationHash;
    propagationNodeInvalid = false;
    propagationNodeMenuOpen = false;
    void persistPropagationNode();
  }

  function openAddIdentity(): void {
    identityEditorMode = 'add';
    identityEditorTarget = undefined;
    identityNameEditorOpen = true;
  }

  function openEditIdentity(identity: IdentitySummary): void {
    identityEditorMode = 'edit';
    identityEditorTarget = identity;
    identityNameEditorOpen = true;
  }

  function addInterface(type: InterfaceType): void {
    editorType = type;
    editorConfig = undefined;
    editorOpen = true;
  }

  function editInterface(config: InterfaceConfig): void {
    editorType = config.type;
    editorConfig = config;
    editorOpen = true;
  }

  function hasEnabledBleDeviceConflict(config: InterfaceConfig): boolean {
    return config.enabled
      && config.type === 'rnode'
      && config.connection.type === 'ble'
      && config.connection.deviceId !== undefined
      && interfaces.some((item) => (
        item.id !== config.id
        && item.enabled
        && item.type === 'rnode'
        && item.connection.type === 'ble'
        && item.connection.deviceId === config.connection.deviceId
      ));
  }

  function unavailableBleDeviceIds(): string[] {
    return interfaces.flatMap((item) => (
      item.id !== editorConfig?.id
      && item.enabled
      && item.type === 'rnode'
      && item.connection.type === 'ble'
      && item.connection.deviceId
        ? [item.connection.deviceId]
        : []
    ));
  }

  async function saveIdentityName(displayName: string): Promise<boolean> {
    return identityEditorMode === 'add'
      ? await reticulumRuntime.createIdentity(displayName)
      : identityEditorTarget
        ? await reticulumRuntime.updateIdentityDisplayName(identityEditorTarget.id, displayName)
        : false;
  }

  async function activateManagedIdentity(identity: IdentitySummary): Promise<void> {
    identityBusyId = identity.id;
    try {
      if (!await reticulumRuntime.activateIdentity(identity.id)) toast.error('settings.identity.activateError');
    } catch {
      toast.error('settings.identity.activateError');
    } finally {
      identityBusyId = undefined;
    }
  }

  async function deleteManagedIdentity(identity: IdentitySummary): Promise<void> {
    identityBusyId = identity.id;
    try {
      if (!await reticulumRuntime.deleteIdentity(identity.id)) toast.error('settings.identity.deleteError');
    } catch {
      toast.error('settings.identity.deleteError');
    } finally {
      identityBusyId = undefined;
      identityDeleteTarget = undefined;
    }
  }

  async function exportManagedIdentity(identity: IdentitySummary): Promise<void> {
    if (!window.confirm(get(t)('settings.identity.exportConfirm', { name: identity.displayName }))) return;
    identityBusyId = identity.id;
    try {
      const backup = await reticulumRuntime.exportIdentity(identity.id);
      if (!backup) {
        toast.error('settings.identity.exportError');
        return;
      }
      const content = Uint8Array.from(backup.content);
      const url = URL.createObjectURL(new Blob([content.buffer], { type: 'application/octet-stream' }));
      content.fill(0);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = backup.filename;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error('settings.identity.exportError');
    } finally {
      identityBusyId = undefined;
    }
  }

  async function importManagedIdentity(event: Event): Promise<void> {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (file.size > 64 * 1024) {
      toast.error('settings.identity.importInvalid');
      return;
    }
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const backup = parseIdentityFile(bytes);
      bytes.fill(0);
      if (!backup) {
        toast.error('settings.identity.importInvalid');
        return;
      }
      if (!await reticulumRuntime.importIdentity(backup)) toast.error('settings.identity.importError');
    } catch {
      toast.error('settings.identity.importError');
    }
  }

  async function unblockDestination(destinationHash: string): Promise<void> {
    if (blockedDestinationBusyHash) return;
    blockedDestinationBusyHash = destinationHash;
    try {
      if (!await reticulumRuntime.unblockChatDestination(destinationHash)) {
        toast.error('chat.unblock.error');
        return;
      }
      toast.success('chat.unblock.success');
    } catch {
      toast.error('chat.unblock.error');
    } finally {
      blockedDestinationBusyHash = undefined;
    }
  }
</script>

<div class="page settings-page">
  <header class="page-header settings-header">
    <div>
      <p class="eyebrow">{$t('app.name')}</p>
      <h1>{$t('settings.title')}</h1>
      <p>{$t('settings.subtitle')}</p>
    </div>
  </header>

  <div class="settings-stack">
    <section class="settings-card">
      <header class="settings-card-header">
        <div class="section-icon identity"><Icon name="identity" size={21} /></div>
        <div><h2>{$t('settings.identity.title')}</h2><p>{$t('settings.identity.description')}</p></div>
        <div class="settings-card-actions">
          <button class="button secondary compact" onclick={() => importInput?.click()}>
            <Icon name="download" size={16} />{$t('settings.identity.import')}
          </button>
          <button class="button primary compact" onclick={openAddIdentity}>
            <Icon name="plus" size={16} />{$t('settings.identity.add')}
          </button>
          <input
            class="sr-only"
            bind:this={importInput}
            type="file"
            aria-label={$t('settings.identity.import')}
            onchange={importManagedIdentity}
          />
        </div>
      </header>
      <div class="identity-list">
        {#if $identities.length === 0}
          <div class="loading-row">{$t('common.loading')}</div>
        {:else}
          {#each $identities as identity (identity.id)}
            <article class="identity-row">
              <div class="identity-avatar">{identity.displayName.slice(0, 1)}</div>
              <div class="identity-copy">
                <div class="identity-name-line">
                  <strong>{identity.displayName}</strong>
                  {#if identity.id === $activeIdentity?.id}
                    <span class="badge success identity-active-mobile">{$t('status.active')}</span>
                  {/if}
                </div>
                <code>{identity.identityHashHex}</code>
              </div>
              {#if identity.id === $activeIdentity?.id}
                <span class="badge success identity-active-desktop">{$t('status.active')}</span>
              {/if}
              <div class="identity-actions">
                <button
                  class="icon-button"
                  class:primary={identity.id !== $activeIdentity?.id}
                  title={$t(identity.id === $activeIdentity?.id ? 'settings.identity.currentlyActive' : 'settings.identity.setActive')}
                  aria-label={$t(identity.id === $activeIdentity?.id ? 'settings.identity.currentlyActive' : 'settings.identity.setActive')}
                  disabled={identity.id === $activeIdentity?.id || identityBusyId === identity.id}
                  onclick={() => activateManagedIdentity(identity)}
                ><Icon name="check" size={16} /></button>
                <button
                  class="icon-button"
                  title={$t('settings.identity.export')}
                  aria-label={$t('settings.identity.export')}
                  disabled={identityBusyId === identity.id}
                  onclick={() => exportManagedIdentity(identity)}
                ><Icon name="upload" size={16} /></button>
                <button
                  class="icon-button"
                  title={$t('settings.identity.editName')}
                  aria-label={$t('settings.identity.editName')}
                  disabled={identityBusyId === identity.id}
                  onclick={() => openEditIdentity(identity)}
                ><Icon name="edit" size={16} /></button>
                <button
                  class="icon-button danger"
                  title={$t(identity.id === $activeIdentity?.id ? 'settings.identity.deleteActiveBlocked' : 'settings.identity.delete')}
                  aria-label={$t(identity.id === $activeIdentity?.id ? 'settings.identity.deleteActiveBlocked' : 'settings.identity.delete')}
                  disabled={identity.id === $activeIdentity?.id || identityBusyId === identity.id}
                  onclick={() => { identityDeleteTarget = identity; }}
                ><Icon name="trash" size={16} /></button>
              </div>
            </article>
          {/each}
          <p class="identity-export-notice">{$t('settings.identity.exportWarning')}</p>
        {/if}
      </div>
    </section>

    <section class="settings-card" id="settings-interfaces">
      <header class="settings-card-header">
        <div class="section-icon"><Icon name="interface" size={21} /></div>
        <div><h2>{$t('settings.interfaces.title')}</h2><p>{$t('settings.interfaces.description')}</p></div>
        <InterfaceTypePicker types={availableInterfaceTypes} onselect={addInterface} />
      </header>

      {#if loading}
        <div class="loading-row">{$t('common.loading')}</div>
      {:else if interfaces.length === 0}
        <EmptyState
          icon="interface"
          title={$t('settings.interfaces.empty.title')}
          body={$t('settings.interfaces.empty.body')}
        />
      {:else}
        <div class="interface-list">
          {#each interfaces as item (item.id)}
            <article class="interface-row">
              <span class:online={$interfaceStatuses[item.id] === 'online'} class="interface-state"></span>
              <div><strong>{item.name}</strong><code>{localizedInterfaceDescription(item)}</code></div>
              <span class:success={$interfaceStatuses[item.id] === 'online'} class="badge">
                {$t(
                  !item.enabled
                    ? 'interface.status.disabled'
                    : $interfaceStatuses[item.id] === 'online'
                      ? 'interface.status.online'
                      : $interfaceStatuses[item.id] === 'connecting'
                        ? 'interface.status.connecting'
                        : $interfaceStatuses[item.id] === 'reconnecting'
                          ? 'interface.status.reconnecting'
                          : $interfaceStatuses[item.id] === 'error'
                            ? 'interface.status.error'
                            : 'interface.status.offline'
                )}
              </span>
              <label
                class="interface-enabled-toggle"
                title={$t(item.enabled ? 'settings.interfaces.disable' : 'settings.interfaces.enable')}
              >
                <input
                  type="checkbox"
                  role="switch"
                  checked={item.enabled}
                  aria-label={$t('settings.interfaces.enabled')}
                  disabled={interfaceBusyId !== undefined}
                  onchange={() => { void toggleInterface(item); }}
                />
              </label>
              <button
                class="icon-button"
                title={$t('settings.interfaces.edit')}
                aria-label={$t('settings.interfaces.edit')}
                disabled={interfaceBusyId === item.id}
                onclick={() => editInterface(item)}
              ><Icon name="edit" size={17} /></button>
              <button
                class="icon-button danger"
                title={$t('settings.interfaces.delete')}
                aria-label={$t('settings.interfaces.delete')}
                disabled={interfaceBusyId === item.id}
                onclick={() => deleteInterface(item)}
              ><Icon name="trash" size={17} /></button>
            </article>
          {/each}
        </div>
      {/if}
    </section>

    <section class="settings-card split-settings">
      <header class="settings-card-header">
        <div class="section-icon"><Icon name="send" size={21} /></div>
        <div><h2>{$t('settings.lxmf.title')}</h2><p>{$t('settings.lxmf.description')}</p></div>
      </header>
      <div class="field-grid two-column lxmf-settings-grid">
        <div class="lxmf-settings-column">
          <label class="field lxmf-sending-method">
            <span>{$t('settings.lxmf.method')}</span>
            <select
              value={preferences.lxmf.defaultDeliveryMethod}
              onchange={(event) => changeDeliveryMethod(event.currentTarget.value as LxmfDeliveryMethod)}
            >
              <option value="direct">{$t('settings.lxmf.method.direct')}</option>
              <option value="opportunistic">{$t('settings.lxmf.method.opportunistic')}</option>
              <option value="propagated">{$t('settings.lxmf.method.propagated')}</option>
            </select>
            <small>{$t(`settings.lxmf.method.${preferences.lxmf.defaultDeliveryMethod}.help` as MessageKey)}</small>
          </label>
          <div class="field lxmf-propagation-address">
            <label for="preferred-propagation-node">{$t('settings.lxmf.propagationNode')}</label>
            <div class="propagation-node-combobox" bind:this={propagationNodePicker}>
              <input
                id="preferred-propagation-node"
                bind:value={propagationNodeDraft}
                placeholder={$t('settings.lxmf.propagationNode.placeholder')}
                autocapitalize="none"
                autocomplete="off"
                spellcheck="false"
                aria-invalid={propagationNodeInvalid}
                aria-autocomplete="list"
                aria-controls="propagation-node-options"
                aria-expanded={propagationNodeMenuOpen}
                oninput={() => { propagationNodeInvalid = false; }}
                onchange={persistPropagationNode}
              />
              <button
                type="button"
                class="propagation-node-menu-toggle"
                aria-label={$t('settings.lxmf.propagationNode.openList')}
                aria-haspopup="listbox"
                aria-expanded={propagationNodeMenuOpen}
                onclick={() => { propagationNodeMenuOpen = !propagationNodeMenuOpen; }}
              ><Icon name="chevron-down" size={17} /></button>
              {#if propagationNodeMenuOpen}
                <div id="propagation-node-options" class="propagation-node-menu" role="listbox" aria-label={$t('settings.lxmf.propagationNode.list')}>
                  {#if $propagationNodeAnnounces.length === 0}
                    <p>{$t('settings.lxmf.propagationNode.empty')}</p>
                  {:else}
                    {#each $propagationNodeAnnounces as announced (announced.destinationHash)}
                      <button
                        type="button"
                        role="option"
                        aria-selected={propagationNodeDraft === announced.destinationHash}
                        disabled={!announced.enabled}
                        onclick={() => selectPropagationNode(announced.destinationHash)}
                      >
                        <code>{announced.destinationHash}</code>
                        <small>
                          {#if announced.hops === undefined}
                            {$t('settings.lxmf.propagationNode.hopsUnknown')}
                          {:else}
                            {$t(announced.hops === 1 ? 'announce.hops.one' : 'announce.hops.other', { count: announced.hops })}
                          {/if}
                          · {$t('settings.lxmf.propagationNode.stampCost', { cost: announced.stampCost })}
                          {#if !announced.enabled} · {$t('settings.lxmf.propagationNode.unavailable')}{/if}
                        </small>
                        <small>{$t('settings.lxmf.propagationNode.lastHeard', {
                          date: propagationHeardAtFormatter.format(new Date(announced.heardAt)),
                        })}</small>
                      </button>
                    {/each}
                  {/if}
                </div>
              {/if}
            </div>
            <small class:field-error={propagationNodeInvalid}>
              {$t(propagationNodeInvalid ? 'settings.lxmf.propagationNode.invalid' : 'settings.lxmf.propagationNode.help')}
            </small>
          </div>
          <label class="toggle-row propagation-toggle delivery-toggle lxmf-propagation-toggle">
            <span>
              <strong>{$t('settings.lxmf.propagationEnabled')}</strong>
              <small>{$t(propagationIsActive(preferences.lxmf)
                ? 'settings.lxmf.propagation.status.active'
                : 'settings.lxmf.propagation.status.disabled')}</small>
            </span>
            <input
              type="checkbox"
              role="switch"
              checked={preferences.lxmf.propagationEnabled || preferences.lxmf.defaultDeliveryMethod === 'propagated'}
              disabled={preferences.lxmf.defaultDeliveryMethod === 'propagated'}
              onchange={(event) => {
                preferences.lxmf.propagationEnabled = event.currentTarget.checked;
                void persistPreferences();
              }}
            />
          </label>
          <label class="field lxmf-propagation-sync-interval">
            <span>{$t('settings.lxmf.propagationSync.interval')}</span>
            <select
              value={preferences.lxmf.propagationSyncIntervalMinutes}
              onchange={(event) => {
                preferences.lxmf.propagationSyncIntervalMinutes = Number(event.currentTarget.value) as PropagationSyncIntervalMinutes;
                void persistPreferences();
              }}
            >
              <option value={0}>{$t('settings.lxmf.propagationSync.interval.never')}</option>
              <option value={15}>{$t('settings.lxmf.propagationSync.interval.15')}</option>
              <option value={30}>{$t('settings.lxmf.propagationSync.interval.30')}</option>
              <option value={60}>{$t('settings.lxmf.propagationSync.interval.60')}</option>
              <option value={180}>{$t('settings.lxmf.propagationSync.interval.180')}</option>
              <option value={360}>{$t('settings.lxmf.propagationSync.interval.360')}</option>
              <option value={720}>{$t('settings.lxmf.propagationSync.interval.720')}</option>
              <option value={1440}>{$t('settings.lxmf.propagationSync.interval.1440')}</option>
            </select>
            <small>{$t('settings.lxmf.propagationSync.interval.help')}</small>
          </label>
        </div>
        <div class="lxmf-settings-column">
          <label class="field lxmf-announcement-interval">
            <span>{$t('settings.lxmf.autoAnnounce.interval')}</span>
            <select
              bind:value={preferences.lxmf.autoAnnounceIntervalMinutes}
              onchange={persistPreferences}
            >
              <option value={0}>{$t('settings.lxmf.autoAnnounce.interval.0')}</option>
              <option value={15}>{$t('settings.lxmf.autoAnnounce.interval.15')}</option>
              <option value={30}>{$t('settings.lxmf.autoAnnounce.interval.30')}</option>
              <option value={60}>{$t('settings.lxmf.autoAnnounce.interval.60')}</option>
              <option value={180}>{$t('settings.lxmf.autoAnnounce.interval.180')}</option>
              <option value={360}>{$t('settings.lxmf.autoAnnounce.interval.360')}</option>
              <option value={720}>{$t('settings.lxmf.autoAnnounce.interval.720')}</option>
              <option value={1440}>{$t('settings.lxmf.autoAnnounce.interval.1440')}</option>
            </select>
            <small>{$t('settings.lxmf.autoAnnounce.interval.help')}</small>
          </label>
          <label class="field lxmf-stamp-cost">
            <span>{$t('settings.lxmf.inboundStampCost')}</span>
            <input
              type="number"
              min="0"
              max="254"
              step="1"
              value={preferences.lxmf.inboundStampCost}
              onchange={(event) => changeInboundStampCost(event.currentTarget.valueAsNumber)}
            />
            <small>{$t('settings.lxmf.inboundStampCost.help')}</small>
          </label>
          <label class="toggle-row propagation-toggle lxmf-contacts-only">
            <span>
              <strong>{$t('settings.lxmf.contactsOnly')}</strong>
              <small>{$t('settings.lxmf.contactsOnly.help')}</small>
            </span>
            <input
              type="checkbox"
              role="switch"
              bind:checked={preferences.lxmf.acceptMessagesFromContactsOnly}
              onchange={persistPreferences}
            />
          </label>
        </div>
      </div>
    </section>

    <section class="settings-card">
      <header class="settings-card-header">
        <div class="section-icon danger"><Icon name="block" size={21} /></div>
        <div>
          <h2>{$t('settings.blocked.title')}</h2>
          <p>{$t('settings.blocked.description')}</p>
        </div>
      </header>
      {#if blockedDestinationEntries.length === 0}
        <p class="blocked-destinations-empty">{$t('settings.blocked.empty')}</p>
      {:else}
        <div class="blocked-destination-list">
          {#each visibleBlockedDestinationEntries as blocked (blocked.id)}
            <article class="blocked-destination-row">
              <div class="blocked-destination-mark"><Icon name="block" size={18} /></div>
              <div class="blocked-destination-copy">
                {#if blocked.name}<strong>{blocked.name}</strong>{/if}
                <code>{blocked.destinationHash}</code>
              </div>
              <button
                class="button secondary compact"
                disabled={blockedDestinationBusyHash !== undefined}
                onclick={() => unblockDestination(blocked.destinationHash)}
              >{$t('chat.unblock.action')}</button>
            </article>
          {/each}
          {#if blockedDestinationEntries.length > 2}
            <button
              class="blocked-destination-toggle"
              class:expanded={blockedDestinationsExpanded}
              type="button"
              aria-expanded={blockedDestinationsExpanded}
              onclick={() => { blockedDestinationsExpanded = !blockedDestinationsExpanded; }}
            >
              {#if blockedDestinationsExpanded}<Icon name="chevron-down" size={17} />{/if}
              <span>{$t(blockedDestinationsExpanded ? 'settings.blocked.hide' : 'settings.blocked.showAll')}</span>
              {#if !blockedDestinationsExpanded}<Icon name="chevron-down" size={17} />{/if}
            </button>
          {/if}
        </div>
      {/if}
    </section>

    <section class="settings-card">
      <header class="settings-card-header">
        <div class="section-icon"><Icon name="palette" size={21} /></div>
        <div><h2>{$t('settings.appearance.title')}</h2></div>
      </header>
      <div class="field-grid two-column">
        <label class="field">
          <span>{$t('settings.appearance.theme')}</span>
          <select
            value={preferences.theme}
            onchange={(event) => {
              preferences.theme = event.currentTarget.value as ThemePreference;
              void persistPreferences();
            }}
          >
            <option value="system">{$t('settings.appearance.theme.system')}</option>
            <option value="dark">{$t('settings.appearance.theme.dark')}</option>
            <option value="light">{$t('settings.appearance.theme.light')}</option>
          </select>
        </label>
        <label class="field">
          <span>{$t('settings.appearance.language')}</span>
          <select disabled><option>{$t('settings.appearance.language.system')}</option></select>
        </label>
      </div>
    </section>

    <section class="settings-card">
      <header class="settings-card-header">
        <div class="section-icon"><Icon name="network" size={21} /></div>
        <div>
          <div class="settings-heading-line">
            <h2>{$t('settings.network.title')}</h2>
            <span class="badge experimental">{$t('settings.network.experimental')}</span>
          </div>
          <p>{$t('settings.network.description')}</p>
        </div>
      </header>
      <label class="toggle-row roomy">
        <span><strong>{$t('settings.network.transport')}</strong><small>{$t('settings.network.transport.note')}</small></span>
        <input type="checkbox" role="switch" bind:checked={preferences.transportEnabled} onchange={persistPreferences} />
      </label>
    </section>

    <section class="settings-card about-card">
      <div class="section-icon"><Icon name="info" size={21} /></div>
      <div class="about-card-copy">
        <div class="about-heading">
          <h2>{$t('settings.about.title')}</h2>
          <span>{$t('settings.about.version', { version: __APP_VERSION__ })}</span>
        </div>
        <p class="about-description">
          {$t('settings.about.basedOnIntro')}
          <a
            href="https://github.com/markqvist/Reticulum"
            target="_blank"
            rel="noopener noreferrer"
            aria-label={$t('settings.about.reticulumLink')}
          >{$t('settings.about.reticulum')}<Icon name="external-link" size={12} /></a>
          {$t('settings.about.poweredBy')}
          <a
            href="https://codeberg.org/Lew_Palm/leviculum"
            target="_blank"
            rel="noopener noreferrer"
            aria-label={$t('settings.about.leviculumLink')}
          >{$t('settings.about.leviculum')}<Icon name="external-link" size={12} /></a>.
        </p>
        <p class="about-description">
          {$t('settings.about.licenseNotice', { license: $t('settings.about.license') })}
        </p>
      </div>
    </section>
  </div>
</div>

{#if identityNameEditorOpen && $activeIdentity}
  <IdentityNameEditor
    currentName={identityEditorMode === 'add'
      ? $t('settings.identity.defaultDisplayName')
      : identityEditorTarget?.displayName ?? $activeIdentity.displayName}
    mode={identityEditorMode}
    oncancel={() => { identityNameEditorOpen = false; identityEditorTarget = undefined; }}
    onsave={saveIdentityName}
  />
{/if}

{#if identityDeleteTarget}
  <IdentityDeleteConfirmation
    identityName={identityDeleteTarget.displayName}
    oncancel={() => { identityDeleteTarget = undefined; }}
    onconfirm={() => deleteManagedIdentity(identityDeleteTarget!)}
  />
{/if}

{#if editorOpen}
  {#if editorType === 'websocket'}
    <WebSocketInterfaceEditor
      config={editorConfig?.type === 'websocket' ? editorConfig : undefined}
      oncancel={() => { editorOpen = false; editorConfig = undefined; }}
      onsave={saveInterface}
    />
  {:else if editorType === 'rnode'}
    <RNodeInterfaceEditor
      config={editorConfig?.type === 'rnode' ? editorConfig : undefined}
      connections={interfaceCapabilities.rnodeConnections}
      unavailableDeviceIds={unavailableBleDeviceIds()}
      oncancel={() => { editorOpen = false; editorConfig = undefined; }}
      onsave={saveInterface}
    />
  {:else if editorType === 'tcp'}
    <TcpInterfaceEditor
      config={editorConfig?.type === 'tcp' ? editorConfig : undefined}
      oncancel={() => { editorOpen = false; editorConfig = undefined; }}
      onsave={saveInterface}
    />
  {:else}
    <UdpInterfaceEditor
      config={editorConfig?.type === 'udp' ? editorConfig : undefined}
      oncancel={() => { editorOpen = false; editorConfig = undefined; }}
      onsave={saveInterface}
    />
  {/if}
{/if}
