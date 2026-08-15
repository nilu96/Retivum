<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { navigateBack } from '../../app/router';
  import type { ReticulumLogEntry, ReticulumLogLevel } from '../../domain/logging';
  import {
    provisioningFieldFlags,
    provisioningFieldTypes,
    type ProvisioningField,
    type ProvisioningNamespace,
    type ProvisioningState,
    type ProvisioningValue,
  } from '../../domain/provisioning';
  import type { RNodeConnectionType, RNodeInterfaceConfig } from '../../domain/settings';
  import { detectInterfaceCapabilities } from '../../infrastructure/platform/interface-capabilities';
  import {
    listAuthorizedRNodes,
    LocalProvisioningClient,
    requestRNode,
    RNodeMaintenanceSession,
    type AuthorizedRNode,
    type LocalRNodeInfo,
  } from '../../infrastructure/platform/rnode-maintenance';
  import {
    appendLocalLog,
    interfaceConfigurations,
    reticulumRuntime,
  } from '../../infrastructure/reticulum/runtime';
  import type { RNodeBatteryState, RNodeInterfaceTelemetry } from '../../infrastructure/reticulum/protocol';
  import { t, type MessageKey } from '../../i18n';
  import ConfirmationDialog from '../../lib/components/ConfirmationDialog.svelte';
  import Icon from '../../lib/components/Icon.svelte';
  import DeviceLogViewer from '../../lib/components/DeviceLogViewer.svelte';
  import { toast } from '../../lib/notifications/toasts';
  import RNodeNodeConfig from './RNodeNodeConfig.svelte';

  type MaintenanceTab = 'device' | 'nodeConfig' | 'provisioning' | 'logs';

  let page: HTMLDivElement;
  let devices = $state<AuthorizedRNode[]>([]);
  let selectedDevice = $state<AuthorizedRNode>();
  let session = $state<RNodeMaintenanceSession>();
  let client = $state<LocalProvisioningClient>();
  let deviceInfo = $state<LocalRNodeInfo>();
  let deviceTelemetry = $state<RNodeInterfaceTelemetry>({});
  let loaded = $state<Awaited<ReturnType<LocalProvisioningClient['load']>>>();
  let draft = $state<ProvisioningState>({});
  let dirtyFields = $state<string[]>([]);
  let activeTab = $state<MaintenanceTab>('device');
  let busy = $state(false);
  let status = $state<MessageKey>('rnodeMaintenance.status.disconnected');
  let deviceLogs = $state<string[]>([]);
  let claimedInterfaceId = $state<string>();
  let wipeEepromPending = $state(false);
  let pendingCommand = $state<{ namespaceId: number; field: ProvisioningField }>();
  let bluetoothPin = $state('');
  let deviceRefresh: Promise<{ ok: boolean; count: number }> | undefined;
  let scrollContainer: HTMLElement | undefined;
  let scrollToTopVisible = $state(false);
  const disconnectedTabs: MaintenanceTab[] = ['device'];
  const standardTabs: MaintenanceTab[] = ['device', 'nodeConfig'];
  const extendedTabs: MaintenanceTab[] = ['device', 'nodeConfig', 'provisioning', 'logs'];
  const availableConnections = detectInterfaceCapabilities().rnodeConnections;
  const platformNames: Record<number, string> = { 0x60: 'Native', 0x70: 'nRF52', 0x80: 'ESP32', 0x90: 'AVR' };
  const mcuNames: Record<number, string> = { 0x61: 'Native', 0x71: 'nRF52840', 0x81: 'ESP32', 0x91: 'ATmega1284P', 0x92: 'ATmega2560' };
  const boardNames: Record<number, string> = {
    0x31: 'RNode v1', 0x32: 'HMBRW', 0x33: 'TTGO T-Beam', 0x34: 'Huzzah32', 0x35: 'Generic ESP32',
    0x36: 'TTGO LoRa32 v2.0', 0x37: 'TTGO LoRa32 v2.1', 0x38: 'Heltec LoRa32 v2', 0x39: 'TTGO LoRa32 v1.0',
    0x3a: 'Heltec LoRa32 v3', 0x3b: 'LilyGO T-Deck', 0x3c: 'Heltec T114', 0x3d: 'T-Beam Supreme',
    0x3e: 'XIAO ESP32-S3', 0x3f: 'Heltec LoRa32 v4', 0x40: 'RNode v2.0', 0x41: 'RNode v2.1',
    0x42: 'T3S3', 0x44: 'LilyGO T-Echo', 0x50: 'Generic nRF52', 0x51: 'WisCore RAK4631', 0x52: 'WisCore RAK3401',
  };

  const rnodeInterfaces = $derived($interfaceConfigurations.filter((config): config is RNodeInterfaceConfig => (
    config.type === 'rnode'
  )));
  const availableRNodeInterfaces = $derived(rnodeInterfaces.filter((config) => (
    availableConnections.includes(config.connection.type)
  )));
  const connected = $derived(session !== undefined);
  const maintenanceTabs = $derived(
    connected ? (loaded ? extendedTabs : standardTabs) : disconnectedTabs,
  );
  const hasRadioLinkTelemetry = $derived([
    deviceTelemetry.currentRssiDbm,
    deviceTelemetry.noiseFloorDbm,
    deviceTelemetry.interferenceDbm,
    deviceTelemetry.lastPacketRssiDbm,
    deviceTelemetry.lastPacketSnrDb,
    deviceTelemetry.radioRxPackets,
    deviceTelemetry.radioTxPackets,
  ].some((value) => value !== undefined));
  const hasChannelTelemetry = $derived([
    deviceTelemetry.airtimeShortPercent,
    deviceTelemetry.airtimeLongPercent,
    deviceTelemetry.channelLoadShortPercent,
    deviceTelemetry.channelLoadLongPercent,
  ].some((value) => value !== undefined));
  const rootNamespaces = $derived(loaded?.schema.namespaces.filter((namespace) => namespace.parentId === 0) ?? []);

  onMount(() => {
    void refreshDevices();
    scrollContainer = page.closest<HTMLElement>('main') ?? undefined;
    scrollContainer?.scrollTo({ top: 0, left: 0 });
    const updateScrollState = (): void => {
      scrollToTopVisible = currentPageScrollTop() > 0;
    };
    scrollContainer?.addEventListener('scroll', updateScrollState, { passive: true });
    window.addEventListener('scroll', updateScrollState, { passive: true });
    const refreshInterval = setInterval(() => {
      if (activeTab === 'device' && !busy) void refreshDevices();
    }, 1_000);
    updateScrollState();
    return () => {
      clearInterval(refreshInterval);
      scrollContainer?.removeEventListener('scroll', updateScrollState);
      window.removeEventListener('scroll', updateScrollState);
      scrollContainer = undefined;
    };
  });

  onDestroy(() => {
    const closingSession = session;
    const releasingInterface = claimedInterfaceId;
    session = undefined;
    client = undefined;
    void closingSession?.close().finally(() => {
      if (releasingInterface) void reticulumRuntime.releaseRNodeInterfaceFromMaintenance(releasingInterface);
    });
  });

  function appendLog(level: ReticulumLogLevel, code: string, details?: ReticulumLogEntry['details']): void {
    appendLocalLog(level, 'rnode', code, details);
  }

  function appendDeviceLogs(message: string): void {
    const lines = message.split(/\r?\n/).filter((line) => line.length > 0);
    if (lines.length > 0) deviceLogs = [...deviceLogs, ...lines].slice(-1_000);
  }

  function codedName(value: number | undefined, names: Record<number, string>): string {
    if (value === undefined) return '—';
    return `${names[value] ?? $t('rnodeMaintenance.device.unknown')} (0x${value.toString(16).padStart(2, '0')})`;
  }

  function percent(value: number | undefined): string {
    return value === undefined ? '—' : `${value.toFixed(2)} %`;
  }

  function battery(state: RNodeBatteryState | undefined, value: number | undefined): string {
    if (value === undefined) return '—';
    return `${value}% (${$t(`status.battery.${state ?? 'unknown'}`)})`;
  }

  function currentPageScrollTop(): number {
    return Math.max(
      scrollContainer?.scrollTop ?? 0,
      window.scrollY,
      document.documentElement.scrollTop,
      document.body.scrollTop,
    );
  }

  function scrollPageToTop(): void {
    scrollToTopVisible = false;
    scrollContainer?.scrollTo({ top: 0, left: 0, behavior: 'smooth' });
    if (window.scrollY > 0 || document.documentElement.scrollTop > 0 || document.body.scrollTop > 0) {
      window.scrollTo({ top: 0, left: 0, behavior: 'smooth' });
    }
  }

  async function refreshDevices(showFeedback = false): Promise<void> {
    const refresh = deviceRefresh ?? (async () => {
      try {
        devices = await listAuthorizedRNodes(availableRNodeInterfaces);
        appendLog('debug', 'RNODE_MAINTENANCE_DEVICES_REFRESHED', { devices: devices.length });
        return { ok: true, count: devices.length };
      } catch (error) {
        appendLog('error', 'RNODE_MAINTENANCE_DEVICES_REFRESH_FAILED', { message: errorMessage(error) });
        return { ok: false, count: 0 };
      }
    })();
    deviceRefresh = refresh;
    try {
      const result = await refresh;
      if (showFeedback && result.ok) toast.success('rnodeMaintenance.device.refreshSuccess', { count: result.count });
      else if (showFeedback) toast.error('rnodeMaintenance.device.refreshError');
    } finally {
      if (deviceRefresh === refresh) deviceRefresh = undefined;
    }
  }

  async function chooseNewDevice(transport: RNodeConnectionType): Promise<void> {
    try {
      const device = await requestRNode(transport, availableRNodeInterfaces);
      devices = [device, ...devices.filter((candidate) => candidate.id !== device.id)];
      await connect(device);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'NotFoundError') return;
      if (error instanceof Error && ['RNODE_BLE_SELECTION_CANCELLED', 'RNODE_BLE_PAIRING_CANCELLED'].some((code) => error.message.includes(code))) return;
      appendLog('error', 'RNODE_MAINTENANCE_SELECTION_FAILED', { transport, message: errorMessage(error) });
      toast.error('rnodeMaintenance.device.selectionError');
    }
  }

  async function claimConfiguredInterface(device: AuthorizedRNode): Promise<void> {
    const interfaceId = device.configuredInterface?.id;
    if (!interfaceId || claimedInterfaceId === interfaceId) return;
    if (claimedInterfaceId) await reticulumRuntime.releaseRNodeInterfaceFromMaintenance(claimedInterfaceId);
    if (await reticulumRuntime.claimRNodeInterfaceForMaintenance(interfaceId)) claimedInterfaceId = interfaceId;
  }

  async function connect(device: AuthorizedRNode): Promise<void> {
    if (busy) return;
    busy = true;
    status = 'rnodeMaintenance.status.connecting';
    await closeProtocolSession(false);
    selectedDevice = device;
    try {
      await claimConfiguredInterface(device);
      deviceTelemetry = {};
      deviceLogs = [];
      const nextSession = new RNodeMaintenanceSession(
        device,
        appendDeviceLogs,
        () => {
          if (session === nextSession) {
            session = undefined;
            client = undefined;
            deviceInfo = undefined;
            deviceTelemetry = {};
            loaded = undefined;
            activeTab = 'device';
            status = 'rnodeMaintenance.status.disconnected';
          }
        },
        (pin) => { bluetoothPin = pin; },
        (telemetry) => { deviceTelemetry = { ...deviceTelemetry, ...telemetry }; },
      );
      const info = await nextSession.open();
      session = nextSession;
      client = new LocalProvisioningClient(nextSession);
      deviceInfo = info;
      bluetoothPin = '';
      loaded = undefined;
      draft = {};
      dirtyFields = [];
      status = 'rnodeMaintenance.status.connected';
      appendLog('info', 'RNODE_MAINTENANCE_CONNECTED', {
        device: device.label,
        ...(info.firmwareVersion ? { firmware: info.firmwareVersion } : {}),
      });
      toast.success('rnodeMaintenance.connect.success', { name: device.label });
      void loadProvisioning();
    } catch (error) {
      appendLog('error', 'RNODE_MAINTENANCE_CONNECT_FAILED', { message: errorMessage(error) });
      toast.error('rnodeMaintenance.connect.error', { name: device.label });
      status = 'rnodeMaintenance.status.disconnected';
      selectedDevice = undefined;
      deviceInfo = undefined;
      deviceTelemetry = {};
      loaded = undefined;
      activeTab = 'device';
      await releaseClaim();
    } finally {
      busy = false;
    }
  }

  async function disconnect(): Promise<void> {
    if (busy) return;
    const deviceName = selectedDevice?.label ?? $t('rnodeMaintenance.device.fallbackName');
    busy = true;
    try {
      await closeProtocolSession(false);
      await releaseClaim();
      status = 'rnodeMaintenance.status.disconnected';
      appendLog('info', 'RNODE_MAINTENANCE_DISCONNECTED', { device: deviceName });
      toast.success('rnodeMaintenance.device.disconnectSuccess', { name: deviceName });
    } catch (error) {
      status = 'rnodeMaintenance.status.error';
      appendLog('error', 'RNODE_MAINTENANCE_DISCONNECT_FAILED', { message: errorMessage(error) });
      toast.error('rnodeMaintenance.device.disconnectError', { name: deviceName });
    } finally {
      selectedDevice = undefined;
      deviceInfo = undefined;
      deviceTelemetry = {};
      loaded = undefined;
      activeTab = 'device';
      busy = false;
    }
  }

  async function closeProtocolSession(release = false): Promise<void> {
    const closing = session;
    session = undefined;
    client = undefined;
    await closing?.close();
    if (release) await releaseClaim();
  }

  async function releaseClaim(): Promise<void> {
    const interfaceId = claimedInterfaceId;
    claimedInterfaceId = undefined;
    if (interfaceId) await reticulumRuntime.releaseRNodeInterfaceFromMaintenance(interfaceId);
  }

  async function loadProvisioning(): Promise<void> {
    const provisioningClient = client;
    if (!provisioningClient) return;
    try {
      const result = await provisioningClient.load();
      if (client !== provisioningClient) return;
      loaded = result;
      draft = structuredClone(result.state);
      dirtyFields = [];
      appendLog('debug', 'RNODE_LOCAL_PROVISIONING_READY', { namespaces: result.schema.namespaces.length });
    } catch (error) {
      if (client !== provisioningClient) return;
      appendLog('warning', 'RNODE_LOCAL_PROVISIONING_UNAVAILABLE', { message: errorMessage(error) });
    }
  }

  function selectMaintenanceTab(tab: MaintenanceTab): void {
    activeTab = tab;
  }

  function namespaceTree(root: ProvisioningNamespace): ProvisioningNamespace[] {
    const all = loaded?.schema.namespaces ?? [];
    const result: ProvisioningNamespace[] = [];
    const visit = (namespace: ProvisioningNamespace) => {
      result.push(namespace);
      all.filter((candidate) => candidate.parentId === namespace.id).forEach(visit);
    };
    visit(root);
    return result;
  }

  function fieldKey(namespaceId: number, fieldId: number): string {
    return `${namespaceId}:${fieldId}`;
  }

  function fieldValue(namespaceId: number, fieldId: number): ProvisioningValue {
    return draft[namespaceId]?.[fieldId] ?? null;
  }

  function updateField(namespaceId: number, field: ProvisioningField, value: ProvisioningValue): void {
    draft = {
      ...draft,
      [namespaceId]: { ...draft[namespaceId], [field.id]: value },
    };
    if ((field.flags & provisioningFieldFlags.writeOnly) !== 0) return;
    const key = fieldKey(namespaceId, field.id);
    if (!dirtyFields.includes(key)) dirtyFields = [...dirtyFields, key];
  }

  function inputValue(value: ProvisioningValue): string | number {
    if (typeof value === 'bigint') return value.toString();
    if (typeof value === 'number' || typeof value === 'string') return value;
    if (value instanceof Uint8Array) return Array.from(value, (byte) => byte.toString(16).padStart(2, '0')).join('');
    return '';
  }

  function updateTextField(namespaceId: number, field: ProvisioningField, raw: string): void {
    if (field.type === provisioningFieldTypes.integer) updateField(namespaceId, field, BigInt(raw || '0'));
    else if (field.type === provisioningFieldTypes.float) updateField(namespaceId, field, Number(raw));
    else if (field.type === provisioningFieldTypes.bytes) {
      const normalized = raw.replace(/[^0-9a-f]/gi, '');
      updateField(namespaceId, field, Uint8Array.from(normalized.match(/.{1,2}/g)?.map((byte) => Number.parseInt(byte, 16)) ?? []));
    } else updateField(namespaceId, field, raw);
  }

  async function saveProvisioning(): Promise<void> {
    if (!client || dirtyFields.length === 0 || busy) return;
    busy = true;
    try {
      const changed: ProvisioningState = {};
      const namespaceIds = new Set<number>();
      for (const key of dirtyFields) {
        const [namespaceId, fieldId] = key.split(':').map(Number);
        namespaceIds.add(namespaceId);
        changed[namespaceId] = { ...changed[namespaceId], [fieldId]: draft[namespaceId]?.[fieldId] ?? null };
      }
      await client.save(changed, [...namespaceIds]);
      appendLog('info', 'RNODE_LOCAL_PROVISIONING_SAVED', { fields: dirtyFields.length });
      await loadProvisioning();
    } catch (error) {
      appendLog('error', 'RNODE_LOCAL_PROVISIONING_SAVE_FAILED', { message: errorMessage(error) });
    } finally {
      busy = false;
    }
  }

  async function sendProvisioningCommand(): Promise<void> {
    const command = pendingCommand;
    if (!command || !client || busy) {
      pendingCommand = undefined;
      return;
    }
    busy = true;
    try {
      await client.save({
        [command.namespaceId]: {
          [command.field.id]: fieldValue(command.namespaceId, command.field.id),
        },
      }, [command.namespaceId]);
      appendLog('info', 'RNODE_LOCAL_PROVISIONING_COMMAND_SENT', { field: command.field.name });
      await loadProvisioning();
    } catch (error) {
      appendLog('error', 'RNODE_LOCAL_PROVISIONING_COMMAND_FAILED', { message: errorMessage(error) });
    } finally {
      busy = false;
      pendingCommand = undefined;
    }
  }

  async function wipeEeprom(): Promise<void> {
    if (!wipeEepromPending || !session || busy) {
      wipeEepromPending = false;
      return;
    }
    busy = true;
    try {
      appendLog('warning', 'RNODE_EEPROM_WIPE_STARTED');
      await session.wipeEeprom();
      await new Promise((resolve) => setTimeout(resolve, 30_000));
      appendLog('info', 'RNODE_EEPROM_WIPE_COMPLETE');
    } catch (error) {
      appendLog('error', 'RNODE_MAINTENANCE_ACTION_FAILED', { message: errorMessage(error) });
    } finally {
      busy = false;
      wipeEepromPending = false;
    }
  }

  function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
</script>

<div bind:this={page} class="page rnode-maintenance-page">
  <header class="page-header provisioning-header">
    <button class="button secondary compact provisioning-back-button" type="button" onclick={() => navigateBack('tools')}>
      <Icon name="arrow-left" size={16} />{$t('rnodeMaintenance.back')}
    </button>
    <div class="provisioning-header-copy">
      <p class="eyebrow">{$t('app.name')}</p>
      <h1>{$t('rnodeMaintenance.title')}</h1>
      <p>{$t('rnodeMaintenance.description')}</p>
    </div>
    <span class="rnode-maintenance-status" class:connected>{$t(status)}</span>
  </header>

  <nav class="scope-tabs rnode-maintenance-tabs" data-tab-count={maintenanceTabs.length} aria-label={$t('rnodeMaintenance.tabs.label')}>
    {#each maintenanceTabs as tab}
      <button class:active={activeTab === tab} disabled={busy} onclick={() => selectMaintenanceTab(tab as MaintenanceTab)}>
        {$t(`rnodeMaintenance.tabs.${tab}`)}
      </button>
    {/each}
  </nav>

  {#if activeTab === 'device'}
    <section class="rnode-maintenance-panel">
      <div class="rnode-maintenance-section-heading">
        <div><h2>{$t('rnodeMaintenance.device.title')}</h2><p>{$t('rnodeMaintenance.device.description')}</p></div>
        <button class="button secondary" type="button" disabled={busy} onclick={() => void refreshDevices(true)}><Icon name="sync" size={16} />{$t('rnodeMaintenance.device.refresh')}</button>
      </div>
      <div class="rnode-device-list">
        {#each devices as device (device.id)}
          <button class:selected={selectedDevice?.id === device.id} disabled={busy} onclick={() => void connect(device)}>
            <span class="tool-icon"><Icon name="radio" size={21} /></span>
            <span><strong>{device.label}</strong><small>{device.detail}{device.configuredInterface ? ` · ${$t('rnodeMaintenance.device.configured')}` : ''}</small></span>
            <Icon name="arrow-right" size={17} />
          </button>
        {:else}
          <p class="rnode-maintenance-empty">{$t('rnodeMaintenance.device.empty')}</p>
        {/each}
      </div>
      <div class="rnode-maintenance-actions">
        {#if availableConnections.includes('serial')}<button class="button primary" type="button" disabled={busy} onclick={() => void chooseNewDevice('serial')}><Icon name="plus" size={16} />{$t('rnodeMaintenance.device.chooseSerial')}</button>{/if}
        {#if availableConnections.includes('ble')}<button class="button primary" type="button" disabled={busy} onclick={() => void chooseNewDevice('ble')}><Icon name="plus" size={16} />{$t('rnodeMaintenance.device.chooseBle')}</button>{/if}
        {#if selectedDevice}<button class="button secondary" type="button" disabled={busy} onclick={() => void disconnect()}>{$t('rnodeMaintenance.device.disconnect')}</button>{/if}
      </div>
      {#if deviceInfo}
        <div class="rnode-device-details">
          <section>
            <h3>{$t('rnodeMaintenance.device.identification')}</h3>
            <dl class="rnode-device-info">
              <div><dt>{$t('rnodeMaintenance.info.firmware')}</dt><dd>{loaded?.info.firmwareVersion ?? deviceInfo.firmwareVersion ?? '—'}</dd></div>
              <div><dt>{$t('rnodeMaintenance.provisioning.schema')}</dt><dd>{loaded?.info.schemaVersion ?? '—'}</dd></div>
              <div><dt>{$t('rnodeMaintenance.info.board')}</dt><dd>{codedName(deviceInfo.board, boardNames)}</dd></div>
              <div><dt>{$t('rnodeMaintenance.info.platform')}</dt><dd>{codedName(deviceInfo.platform, platformNames)}</dd></div>
              <div><dt>{$t('rnodeMaintenance.info.mcu')}</dt><dd>{codedName(deviceInfo.mcu, mcuNames)}</dd></div>
              <div><dt>{$t('rnodeMaintenance.info.eeprom')}</dt><dd>{deviceInfo.eepromBytes ?? '—'}</dd></div>
              <div><dt>{$t('rnodeMaintenance.provisioning.rebootRequired')}</dt><dd>{loaded ? $t(loaded.info.needsReboot ? 'provisioning.info.yes' : 'provisioning.info.no') : '—'}</dd></div>
              {#if deviceTelemetry.batteryPercent !== undefined}<div><dt>{$t('status.metric.battery')}</dt><dd>{battery(deviceTelemetry.batteryState, deviceTelemetry.batteryPercent)}</dd></div>{/if}
              {#if deviceTelemetry.temperatureCelsius !== undefined}<div><dt>{$t('rnodeMaintenance.info.temperature')}</dt><dd>{deviceTelemetry.temperatureCelsius} °C</dd></div>{/if}
            </dl>
          </section>
          {#if hasRadioLinkTelemetry}<section>
            <h3>{$t('rnodeMaintenance.device.radioLink')}</h3>
            <dl class="rnode-device-info compact">
              {#if deviceTelemetry.currentRssiDbm !== undefined}<div><dt>{$t('rnodeMaintenance.info.currentRssi')}</dt><dd>{deviceTelemetry.currentRssiDbm} dBm</dd></div>{/if}
              {#if deviceTelemetry.noiseFloorDbm !== undefined}<div><dt>{$t('status.metric.noiseFloor')}</dt><dd>{deviceTelemetry.noiseFloorDbm} dBm</dd></div>{/if}
              {#if deviceTelemetry.interferenceDbm !== undefined}<div><dt>{$t('rnodeMaintenance.info.interference')}</dt><dd>{deviceTelemetry.interferenceDbm} dBm</dd></div>{/if}
              {#if deviceTelemetry.lastPacketRssiDbm !== undefined}<div><dt>{$t('status.metric.lastRssi')}</dt><dd>{deviceTelemetry.lastPacketRssiDbm} dBm</dd></div>{/if}
              {#if deviceTelemetry.lastPacketSnrDb !== undefined}<div><dt>{$t('status.metric.lastSnr')}</dt><dd>{deviceTelemetry.lastPacketSnrDb} dB</dd></div>{/if}
              {#if deviceTelemetry.radioRxPackets !== undefined}<div><dt>{$t('status.metric.radioRxPackets')}</dt><dd>{deviceTelemetry.radioRxPackets}</dd></div>{/if}
              {#if deviceTelemetry.radioTxPackets !== undefined}<div><dt>{$t('status.metric.radioTxPackets')}</dt><dd>{deviceTelemetry.radioTxPackets}</dd></div>{/if}
            </dl>
          </section>{/if}
          {#if hasChannelTelemetry}<section>
            <h3>{$t('rnodeMaintenance.device.channel')}</h3>
            <dl class="rnode-device-info compact">
              {#if deviceTelemetry.airtimeShortPercent !== undefined}<div><dt>{$t('rnodeMaintenance.info.airtimeShort')}</dt><dd>{percent(deviceTelemetry.airtimeShortPercent)}</dd></div>{/if}
              {#if deviceTelemetry.airtimeLongPercent !== undefined}<div><dt>{$t('rnodeMaintenance.info.airtimeLong')}</dt><dd>{percent(deviceTelemetry.airtimeLongPercent)}</dd></div>{/if}
              {#if deviceTelemetry.channelLoadShortPercent !== undefined}<div><dt>{$t('rnodeMaintenance.info.utilizationShort')}</dt><dd>{percent(deviceTelemetry.channelLoadShortPercent)}</dd></div>{/if}
              {#if deviceTelemetry.channelLoadLongPercent !== undefined}<div><dt>{$t('rnodeMaintenance.info.utilizationLong')}</dt><dd>{percent(deviceTelemetry.channelLoadLongPercent)}</dd></div>{/if}
            </dl>
          </section>{/if}
        </div>
      {/if}
      <aside class="rnode-maintenance-notice"><Icon name="info" size={18} /><p>{$t('rnodeMaintenance.device.claimNotice')}</p></aside>
    </section>
  {:else if activeTab === 'nodeConfig'}
    <section class="rnode-maintenance-panel rnode-node-config-panel">
      <div class="rnode-maintenance-section-heading"><div><h2>{$t('rnodeMaintenance.nodeConfig.title')}</h2><p>{$t('rnodeMaintenance.nodeConfig.description')}</p></div></div>
      <RNodeNodeConfig
        {session}
        {bluetoothPin}
        onlog={appendLog}
        onwipe={() => { wipeEepromPending = true; }}
      />
    </section>
  {:else if activeTab === 'provisioning'}
    <section class="rnode-maintenance-panel">
      <div class="rnode-maintenance-section-heading">
        <div><h2>{$t('rnodeMaintenance.provisioning.title')}</h2><p>{$t('rnodeMaintenance.provisioning.description')}</p></div>
        {#if client}<button class="button secondary" type="button" disabled={busy} onclick={() => void loadProvisioning()}><Icon name="sync" size={16} />{$t('rnodeMaintenance.provisioning.reload')}</button>{/if}
      </div>
      {#if !connected}
        <p class="rnode-maintenance-empty">{$t('rnodeMaintenance.provisioning.connectFirst')}</p>
      {:else if !loaded}
        <p class="rnode-maintenance-empty">{$t('rnodeMaintenance.provisioning.unavailable')}</p>
      {:else}
        <dl class="rnode-device-info compact">
          <div><dt>{$t('rnodeMaintenance.info.firmware')}</dt><dd>{loaded.info.firmwareVersion ?? '—'}</dd></div>
          <div><dt>{$t('rnodeMaintenance.provisioning.schema')}</dt><dd>{loaded.info.schemaVersion ?? '—'}</dd></div>
          <div><dt>{$t('rnodeMaintenance.provisioning.rebootRequired')}</dt><dd>{loaded.info.needsReboot ? $t('provisioning.info.yes') : $t('provisioning.info.no')}</dd></div>
        </dl>
        <div class="rnode-provisioning-sections">
          {#each rootNamespaces as root (root.id)}
            <section>
              <h3>{root.name}</h3>
              {#each namespaceTree(root) as namespace (namespace.id)}
                {#if namespace.id !== root.id}<h4>{namespace.name}</h4>{/if}
                <div class="rnode-provisioning-fields">
                  {#each namespace.fields as field (field.id)}
                    <label class="field" class:readonly={(field.flags & provisioningFieldFlags.readOnly) !== 0}>
                      <span>{field.name}</span>
                      {#if (field.flags & provisioningFieldFlags.readOnly) !== 0}
                        <output>{String(inputValue(fieldValue(namespace.id, field.id)) || '—')}</output>
                      {:else if (field.flags & provisioningFieldFlags.writeOnly) !== 0}
                        <div class="rnode-command-controls">
                          {#if field.type !== provisioningFieldTypes.void}
                            <input
                              type={(field.flags & provisioningFieldFlags.secret) !== 0 ? 'password' : field.type === provisioningFieldTypes.integer || field.type === provisioningFieldTypes.float ? 'number' : 'text'}
                              value={inputValue(fieldValue(namespace.id, field.id))}
                              onchange={(event) => updateTextField(namespace.id, field, event.currentTarget.value)}
                            />
                          {/if}
                          <button class="button secondary" type="button" disabled={busy} onclick={() => { pendingCommand = { namespaceId: namespace.id, field }; }}>{$t('provisioning.command.send')}</button>
                        </div>
                      {:else if field.type === provisioningFieldTypes.boolean}
                        <input type="checkbox" role="switch" checked={fieldValue(namespace.id, field.id) === true} onchange={(event) => updateField(namespace.id, field, event.currentTarget.checked)} />
                      {:else if field.type === provisioningFieldTypes.enumeration}
                        <select value={String(field.enumValues?.findIndex((value) => Object.is(value, fieldValue(namespace.id, field.id))) ?? -1)} onchange={(event) => { const value = field.enumValues?.[Number(event.currentTarget.value)]; if (value !== undefined) updateField(namespace.id, field, value); }}>
                          {#each field.enumValues ?? [] as _value, index}<option value={index}>{field.enumLabels?.[index] ?? String(inputValue(_value))}</option>{/each}
                        </select>
                      {:else}
                        <input
                          type={(field.flags & provisioningFieldFlags.secret) !== 0 ? 'password' : field.type === provisioningFieldTypes.integer || field.type === provisioningFieldTypes.float ? 'number' : 'text'}
                          value={inputValue(fieldValue(namespace.id, field.id))}
                          min={field.minInteger ?? field.minFloat}
                          max={field.maxInteger ?? field.maxFloat}
                          maxlength={field.maxLength}
                          onchange={(event) => updateTextField(namespace.id, field, event.currentTarget.value)}
                        />
                      {/if}
                    </label>
                  {/each}
                </div>
              {/each}
            </section>
          {/each}
        </div>
        <div class="rnode-maintenance-actions sticky-actions">
          <button class="button primary" type="button" disabled={dirtyFields.length === 0 || busy} onclick={() => void saveProvisioning()}>{$t('rnodeMaintenance.provisioning.save', { count: dirtyFields.length })}</button>
        </div>
      {/if}
    </section>
  {:else}
    <section class="rnode-maintenance-panel local-log-panel">
      <div class="rnode-maintenance-section-heading"><div><h2>{$t('rnodeMaintenance.logs.title')}</h2><p>{$t('rnodeMaintenance.logs.description')}</p></div></div>
      <DeviceLogViewer lines={deviceLogs} onclear={() => { deviceLogs = []; }} />
    </section>
  {/if}
  {#if scrollToTopVisible}
    <button
      class="icon-button message-scroll-latest rnode-maintenance-scroll-top"
      type="button"
      title={$t('rnodeMaintenance.scrollToTop')}
      aria-label={$t('rnodeMaintenance.scrollToTop')}
      onclick={scrollPageToTop}
    ><Icon name="chevron-up" size={20} /></button>
  {/if}
</div>

{#if wipeEepromPending}
  <ConfirmationDialog titleId="rnode-wipe-eeprom" title={$t('rnodeMaintenance.confirm.wipe.title')} description={$t('rnodeMaintenance.confirm.wipe.description')} icon="trash" tone="danger" confirmLabel={$t('rnodeMaintenance.confirm.wipe.action')} oncancel={() => { wipeEepromPending = false; }} onconfirm={wipeEeprom} />
{:else if pendingCommand}
  <ConfirmationDialog titleId="rnode-local-command" title={$t('provisioning.command.dialog.title')} description={$t('provisioning.command.confirm', { name: pendingCommand.field.name })} icon="send" confirmLabel={$t('provisioning.command.send')} oncancel={() => { pendingCommand = undefined; }} onconfirm={sendProvisioningCommand} />
{/if}
