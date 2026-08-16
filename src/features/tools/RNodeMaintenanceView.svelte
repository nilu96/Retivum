<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { navigateBack } from '../../app/router';
  import type { ReticulumLogEntry, ReticulumLogLevel } from '../../domain/logging';
  import {
    provisioningFieldTypes,
    type ProvisioningField,
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
    interfaceStatuses,
    reticulumRuntime,
  } from '../../infrastructure/reticulum/runtime';
  import type { RNodeBatteryState, RNodeInterfaceTelemetry } from '../../infrastructure/reticulum/protocol';
  import { t, type MessageKey } from '../../i18n';
  import ConfirmationDialog from '../../lib/components/ConfirmationDialog.svelte';
  import Icon from '../../lib/components/Icon.svelte';
  import DeviceLogViewer from '../../lib/components/DeviceLogViewer.svelte';
  import ModalDialog from '../../lib/components/ModalDialog.svelte';
  import { liveActivity, toast } from '../../lib/notifications/toasts';
  import ProvisioningNamespaceEditor from '../provisioning/ProvisioningNamespaceEditor.svelte';
  import ProvisioningSaveBar from '../provisioning/ProvisioningSaveBar.svelte';
  import {
    provisioningEditableState,
    provisioningFieldIsWriteOnly,
    provisioningFieldKey,
    provisioningStateWithDrafts,
    provisioningValuesEqual,
  } from '../provisioning/provisioning-editor';
  import RNodeNodeConfig from './RNodeNodeConfig.svelte';

  type MaintenanceTab = 'device' | 'nodeConfig' | 'provisioning' | 'logs';
  interface DeviceLogLine {
    id: number;
    text: string;
  }

  let devices = $state<AuthorizedRNode[]>([]);
  let selectedDevice = $state<AuthorizedRNode>();
  let session = $state<RNodeMaintenanceSession>();
  let client = $state<LocalProvisioningClient>();
  let deviceInfo = $state<LocalRNodeInfo>();
  let deviceTelemetry = $state<RNodeInterfaceTelemetry>({});
  let loaded = $state<Awaited<ReturnType<LocalProvisioningClient['load']>>>();
  let draft = $state<ProvisioningState>({});
  let dirtyFields = $state<string[]>([]);
  let commandValues = $state<Record<string, ProvisioningValue>>({});
  let fieldValidationErrors = $state<Record<string, string>>({});
  let activeTab = $state<MaintenanceTab>('device');
  let busy = $state(false);
  let status = $state<MessageKey>('rnodeMaintenance.status.disconnected');
  let deviceLogs = $state<DeviceLogLine[]>([]);
  let nextDeviceLogId = 1;
  let claimedInterfaceId = $state<string>();
  let wipeEepromPending = $state(false);
  let pendingDeviceAction = $state<'reboot' | 'factoryReset'>();
  let pendingCommand = $state<{ namespaceId: number; field: ProvisioningField }>();
  let bluetoothPin = $state('');
  let connectionDetailsOpen = $state(false);
  let deviceRefresh: Promise<{ ok: boolean; count: number }> | undefined;
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
  const validationErrorCount = $derived(Object.keys(fieldValidationErrors).length);

  onMount(() => {
    void refreshDevices();
    const refreshInterval = setInterval(() => {
      if (activeTab === 'device' && !busy) void refreshDevices();
    }, 1_000);
    return () => {
      clearInterval(refreshInterval);
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
    if (lines.length > 0) {
      deviceLogs = [
        ...deviceLogs,
        ...lines.map((text) => ({ id: nextDeviceLogId++, text })),
      ].slice(-1_000);
    }
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

  function deviceLabel(device: AuthorizedRNode): string {
    return device.label?.trim() || $t('rnodeMaintenance.device.serialFallbackName');
  }

  function connectionDeviceName(device: AuthorizedRNode): string | undefined {
    if (device.transport === 'ble') {
      return device.connectionConfig.connection.deviceName?.trim() || device.label;
    }
    return device.deviceName?.trim() || undefined;
  }

  function connectionIdentifier(device: AuthorizedRNode): string {
    return device.transport === 'serial'
      ? device.detail
      : device.connectionConfig.connection.deviceId ?? device.id;
  }

  function connectedMaintenanceDevices(candidates: AuthorizedRNode[]): AuthorizedRNode[] {
    const activeBleDeviceId = session && selectedDevice?.transport === 'ble'
      ? selectedDevice.id
      : undefined;
    return candidates.filter((candidate) => (
      candidate.transport === 'serial'
      || (candidate.transport === 'ble' && candidate.connected)
      || candidate.id === activeBleDeviceId
      || (candidate.configuredInterface !== undefined
        && $interfaceStatuses[candidate.configuredInterface.id] === 'online')
    ));
  }

  async function refreshDevices(showFeedback = false): Promise<void> {
    const refresh = deviceRefresh ?? (async () => {
      try {
        const discoveredDevices = await listAuthorizedRNodes(availableRNodeInterfaces);
        const activeDevice = session ? selectedDevice : undefined;
        const candidates = activeDevice
          ? [activeDevice, ...discoveredDevices.filter((candidate) => candidate.id !== activeDevice.id)]
          : discoveredDevices;
        devices = connectedMaintenanceDevices(candidates);
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
      if (error instanceof Error && error.message.includes('RNODE_BLE_SELECTION_CANCELLED')) return;
      appendLog('error', 'RNODE_MAINTENANCE_SELECTION_FAILED', { transport, message: errorMessage(error) });
      toast.error(error instanceof Error && error.message.includes('RNODE_BLE_PAIRING_FAILED')
        ? 'rnodeMaintenance.device.pairingError'
        : 'rnodeMaintenance.device.selectionError');
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
    const deviceName = deviceLabel(device);
    busy = true;
    connectionDetailsOpen = false;
    status = 'rnodeMaintenance.status.connecting';
    const activity = liveActivity.start('rnodeMaintenance.connect.connecting', { name: deviceName });
    try {
      await closeProtocolSession(false);
      selectedDevice = device;
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
            connectionDetailsOpen = false;
            if (nextSession.device.transport === 'ble') {
              devices = devices.filter((candidate) => candidate.id !== nextSession.device.id);
              selectedDevice = undefined;
            }
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
      commandValues = {};
      fieldValidationErrors = {};
      status = 'rnodeMaintenance.status.connected';
      appendLog('info', 'RNODE_MAINTENANCE_CONNECTED', {
        device: deviceName,
        ...(info.firmwareVersion ? { firmware: info.firmwareVersion } : {}),
      });
      activity.success('rnodeMaintenance.connect.success', { name: deviceName });
      void loadProvisioning();
    } catch (error) {
      appendLog('error', 'RNODE_MAINTENANCE_CONNECT_FAILED', { message: errorMessage(error) });
      activity.error('rnodeMaintenance.connect.error', { name: deviceName });
      status = 'rnodeMaintenance.status.disconnected';
      selectedDevice = undefined;
      if (device.transport === 'ble') devices = devices.filter((candidate) => candidate.id !== device.id);
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
    connectionDetailsOpen = false;
    const disconnectedDevice = selectedDevice;
    const deviceName = selectedDevice ? deviceLabel(selectedDevice) : $t('rnodeMaintenance.device.fallbackName');
    const restoringConfiguredInterface = claimedInterfaceId !== undefined
      && rnodeInterfaces.some((config) => config.id === claimedInterfaceId && config.enabled);
    busy = true;
    status = 'rnodeMaintenance.status.disconnecting';
    const activity = liveActivity.start('rnodeMaintenance.device.disconnecting', { name: deviceName });
    try {
      await closeProtocolSession(false);
      const restoration = releaseClaim();
      if (!restoringConfiguredInterface) await restoration;
      status = 'rnodeMaintenance.status.disconnected';
      appendLog('info', 'RNODE_MAINTENANCE_DISCONNECTED', { device: deviceName });
      activity.success(
        restoringConfiguredInterface
          ? 'rnodeMaintenance.device.disconnectSuccessRestoring'
          : 'rnodeMaintenance.device.disconnectSuccess',
        { name: deviceName },
      );
      if (restoringConfiguredInterface) {
        void restoration.catch((error) => {
          appendLog('error', 'RNODE_MAINTENANCE_INTERFACE_RESTORE_FAILED', { message: errorMessage(error) });
          toast.error('rnodeMaintenance.device.restoreError', { name: deviceName });
        });
      }
    } catch (error) {
      status = 'rnodeMaintenance.status.error';
      appendLog('error', 'RNODE_MAINTENANCE_DISCONNECT_FAILED', { message: errorMessage(error) });
      activity.error('rnodeMaintenance.device.disconnectError', { name: deviceName });
    } finally {
      if (disconnectedDevice?.transport === 'ble') {
        devices = devices.filter((candidate) => candidate.id !== disconnectedDevice.id);
      }
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

  async function loadProvisioning(showFeedback = false): Promise<void> {
    const provisioningClient = client;
    if (!provisioningClient) return;
    try {
      const result = await provisioningClient.load();
      if (client !== provisioningClient) return;
      loaded = result;
      draft = provisioningStateWithDrafts(result.state, result.drafts);
      dirtyFields = [];
      commandValues = {};
      fieldValidationErrors = {};
      appendLog('debug', 'RNODE_LOCAL_PROVISIONING_READY', { namespaces: result.schema.namespaces.length });
      if (showFeedback) toast.success('rnodeMaintenance.provisioning.reloadSuccess');
    } catch (error) {
      if (client !== provisioningClient) return;
      appendLog('warning', 'RNODE_LOCAL_PROVISIONING_UNAVAILABLE', { message: errorMessage(error) });
      if (showFeedback) toast.error('rnodeMaintenance.provisioning.reloadError');
    }
  }

  function selectMaintenanceTab(tab: MaintenanceTab): void {
    activeTab = tab;
  }

  function fieldKey(namespaceId: number, fieldId: number): string {
    return provisioningFieldKey(namespaceId, fieldId);
  }

  function fieldValidationError(namespaceId: number, field: ProvisioningField): string | undefined {
    return fieldValidationErrors[fieldKey(namespaceId, field.id)];
  }

  function setFieldValidationError(namespaceId: number, field: ProvisioningField, error?: string): void {
    const key = fieldKey(namespaceId, field.id);
    if (error) fieldValidationErrors = { ...fieldValidationErrors, [key]: error };
    else if (fieldValidationErrors[key]) {
      fieldValidationErrors = Object.fromEntries(Object.entries(fieldValidationErrors)
        .filter(([candidate]) => candidate !== key));
    }
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

  function fieldValue(namespaceId: number, field: ProvisioningField): ProvisioningValue | undefined {
    return draft[namespaceId]?.[field.id] ?? field.defaultValue;
  }

  function updateField(namespaceId: number, field: ProvisioningField, value: ProvisioningValue): void {
    draft = {
      ...draft,
      [namespaceId]: { ...draft[namespaceId], [field.id]: value },
    };
    const key = fieldKey(namespaceId, field.id);
    if (provisioningValuesEqual(value, originalFieldValue(namespaceId, field))) {
      dirtyFields = dirtyFields.filter((candidate) => candidate !== key);
    } else if (!dirtyFields.includes(key)) dirtyFields = [...dirtyFields, key];
  }

  function editableFieldValue(namespaceId: number, field: ProvisioningField): ProvisioningValue | undefined {
    return provisioningFieldIsWriteOnly(field)
      ? commandValues[fieldKey(namespaceId, field.id)] ?? field.defaultValue
      : fieldValue(namespaceId, field);
  }

  function updateEditableField(namespaceId: number, field: ProvisioningField, value: ProvisioningValue): void {
    if (provisioningFieldIsWriteOnly(field)) {
      commandValues = { ...commandValues, [fieldKey(namespaceId, field.id)]: value };
    } else updateField(namespaceId, field, value);
  }

  function revertProvisioning(): void {
    if (!loaded || busy) return;
    draft = provisioningStateWithDrafts(loaded.state, loaded.drafts);
    dirtyFields = [];
    commandValues = {};
    fieldValidationErrors = {};
  }

  function requestProvisioningCommand(namespaceId: number, field: ProvisioningField): void {
    if (!client || busy || fieldValidationError(namespaceId, field)) return;
    const value = field.type === provisioningFieldTypes.void
      ? null
      : editableFieldValue(namespaceId, field);
    if (value !== undefined) pendingCommand = { namespaceId, field };
  }

  async function saveProvisioning(): Promise<void> {
    if (!client || !loaded || dirtyFields.length === 0 || validationErrorCount > 0 || busy) return;
    const changedFieldCount = dirtyFields.length;
    const namespaceIds = new Set(dirtyFields.map((key) => Number(key.split(':', 1)[0])));
    busy = true;
    try {
      const result = await client.save(provisioningEditableState(dirtyFields, draft, namespaceIds), [...namespaceIds]);
      appendLog('info', 'RNODE_LOCAL_PROVISIONING_SAVED', { fields: changedFieldCount });
      await loadProvisioning();
      toast.success(result.needsReboot
        ? 'rnodeMaintenance.provisioning.saveSuccessRebootRequired'
        : 'rnodeMaintenance.provisioning.saveSuccess', { count: changedFieldCount });
    } catch (error) {
      appendLog('error', 'RNODE_LOCAL_PROVISIONING_SAVE_FAILED', { message: errorMessage(error) });
      toast.error('rnodeMaintenance.provisioning.saveError');
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
    const value = command.field.type === provisioningFieldTypes.void
      ? null
      : editableFieldValue(command.namespaceId, command.field);
    if (value === undefined) {
      pendingCommand = undefined;
      return;
    }
    busy = true;
    try {
      await client.save({
        [command.namespaceId]: {
          [command.field.id]: value,
        },
      }, [command.namespaceId]);
      commandValues = Object.fromEntries(Object.entries(commandValues)
        .filter(([key]) => key !== fieldKey(command.namespaceId, command.field.id)));
      appendLog('info', 'RNODE_LOCAL_PROVISIONING_COMMAND_SENT', { field: command.field.name });
      await loadProvisioning();
      toast.success('provisioning.command.success');
    } catch (error) {
      appendLog('error', 'RNODE_LOCAL_PROVISIONING_COMMAND_FAILED', { message: errorMessage(error) });
      toast.error('provisioning.command.failed');
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

  async function rebootDevice(): Promise<void> {
    const activeSession = session;
    if (pendingDeviceAction !== 'reboot' || !activeSession || busy) {
      pendingDeviceAction = undefined;
      return;
    }
    busy = true;
    try {
      await activeSession.reboot();
      appendLog('info', 'RNODE_MAINTENANCE_REBOOT_SENT');
      toast.success('provisioning.reboot.sent');
      await closeProtocolSession(false);
      await releaseClaim();
      selectedDevice = undefined;
      deviceInfo = undefined;
      deviceTelemetry = {};
      loaded = undefined;
      activeTab = 'device';
      status = 'rnodeMaintenance.status.disconnected';
      connectionDetailsOpen = false;
    } catch (error) {
      appendLog('error', 'RNODE_MAINTENANCE_REBOOT_FAILED', { message: errorMessage(error) });
      toast.error('provisioning.reboot.failed');
    } finally {
      busy = false;
      pendingDeviceAction = undefined;
    }
  }

  async function factoryResetDevice(): Promise<void> {
    const provisioningClient = client;
    if (pendingDeviceAction !== 'factoryReset' || !provisioningClient || !loaded || busy) {
      pendingDeviceAction = undefined;
      return;
    }
    busy = true;
    try {
      await provisioningClient.factoryReset();
      appendLog('warning', 'RNODE_LOCAL_PROVISIONING_FACTORY_RESET_SENT');
      toast.success('provisioning.factoryReset.sent');
      await loadProvisioning();
    } catch (error) {
      appendLog('error', 'RNODE_LOCAL_PROVISIONING_FACTORY_RESET_FAILED', { message: errorMessage(error) });
      toast.error('provisioning.factoryReset.failed');
    } finally {
      busy = false;
      pendingDeviceAction = undefined;
    }
  }

  function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
</script>

<div class="page rnode-maintenance-page">
  <header class="page-header provisioning-header">
    <button class="button secondary compact provisioning-back-button" type="button" onclick={() => navigateBack('tools')}>
      <Icon name="arrow-left" size={16} />{$t('rnodeMaintenance.back')}
    </button>
    <div class="provisioning-header-copy">
      <p class="eyebrow">{$t('app.name')}</p>
      <h1>{$t('rnodeMaintenance.title')}</h1>
      <p>{$t('rnodeMaintenance.description')}</p>
    </div>
    {#if connected}
      <button
        class="rnode-maintenance-status connected rnode-maintenance-status-button"
        type="button"
        title={$t('rnodeMaintenance.connection.open')}
        aria-haspopup="dialog"
        aria-expanded={connectionDetailsOpen}
        disabled={busy}
        onclick={() => { connectionDetailsOpen = true; }}
      >{$t(status)}</button>
    {:else}
      <span class="rnode-maintenance-status">{$t(status)}</span>
    {/if}
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
            <span><strong>{deviceLabel(device)}</strong><small>{device.detail}{device.configuredInterface ? ` · ${$t('rnodeMaintenance.device.configured')}` : ''}</small></span>
            <Icon name="arrow-right" size={17} />
          </button>
        {:else}
          <p class="rnode-maintenance-empty">{$t('rnodeMaintenance.device.empty')}</p>
        {/each}
      </div>
      <div class="rnode-maintenance-actions">
        {#if availableConnections.includes('serial')}<button class="button primary" type="button" disabled={busy} onclick={() => void chooseNewDevice('serial')}><Icon name="interface" size={16} />{$t('rnodeMaintenance.device.chooseSerial')}</button>{/if}
        {#if availableConnections.includes('ble')}<button class="button primary" type="button" disabled={busy} onclick={() => void chooseNewDevice('ble')}><Icon name="bluetooth" size={16} />{$t('rnodeMaintenance.device.chooseBle')}</button>{/if}
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
              {#if deviceTelemetry.batteryPercent !== undefined}<div><dt>{$t('status.metric.battery')}</dt><dd>{battery(deviceTelemetry.batteryState, deviceTelemetry.batteryPercent)}</dd></div>{/if}
              {#if deviceTelemetry.temperatureCelsius !== undefined}<div><dt>{$t('rnodeMaintenance.info.temperature')}</dt><dd>{deviceTelemetry.temperatureCelsius} °C</dd></div>{/if}
              <div>
                <dt>{$t('rnodeMaintenance.provisioning.rebootRequired')}</dt>
                <dd>
                  {#if loaded?.info.needsReboot === true}
                    <span class="badge experimental">{$t('provisioning.info.yes')}</span>
                  {:else if loaded?.info.needsReboot === false}
                    <span class="badge success">{$t('provisioning.info.no')}</span>
                  {:else}
                    —
                  {/if}
                </dd>
              </div>
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
          <section class="rnode-device-danger-zone">
            <h3>{$t('rnodeMaintenance.device.dangerZone')}</h3>
            <p class="rnode-maintenance-help">{$t('rnodeMaintenance.device.dangerDescription')}</p>
            <div class="rnode-maintenance-actions">
              <button class="button secondary" type="button" disabled={busy} onclick={() => { pendingDeviceAction = 'reboot'; }}><Icon name="sync" size={16} />{$t('provisioning.reboot')}</button>
              {#if loaded}<button class="button danger" type="button" disabled={busy} onclick={() => { pendingDeviceAction = 'factoryReset'; }}><Icon name="trash" size={16} />{$t('provisioning.factoryReset')}</button>{/if}
            </div>
          </section>
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
        {#if client}<button class="button secondary" type="button" disabled={busy} onclick={() => void loadProvisioning(true)}><Icon name="sync" size={16} />{$t('rnodeMaintenance.provisioning.reload')}</button>{/if}
      </div>
      {#if !connected}
        <p class="rnode-maintenance-empty">{$t('rnodeMaintenance.provisioning.connectFirst')}</p>
      {:else if !loaded}
        <p class="rnode-maintenance-empty">{$t('rnodeMaintenance.provisioning.unavailable')}</p>
      {:else}
        <dl class="rnode-device-info compact">
          <div><dt>{$t('rnodeMaintenance.info.board')}</dt><dd>{codedName(deviceInfo?.board, boardNames)}</dd></div>
          <div><dt>{$t('rnodeMaintenance.info.firmware')}</dt><dd>{loaded.info.firmwareVersion ?? '—'}</dd></div>
          <div><dt>{$t('rnodeMaintenance.provisioning.schema')}</dt><dd>{loaded.info.schemaVersion ?? '—'}</dd></div>
          <div>
            <dt>{$t('rnodeMaintenance.provisioning.rebootRequired')}</dt>
            <dd>
              {#if loaded.info.needsReboot}
                <span class="badge experimental">{$t('provisioning.info.yes')}</span>
              {:else}
                <span class="badge success">{$t('provisioning.info.no')}</span>
              {/if}
            </dd>
          </div>
        </dl>
        <div class="provisioning-editor-content">
          <div
            class="provisioning-namespace-list local-provisioning-namespace-list"
            class:has-save-bar={dirtyFields.length > 0}
          >
            <div class="provisioning-namespace-content">
              {#each rootNamespaces as root (root.id)}
                <div class="provisioning-namespace-card">
                  <ProvisioningNamespaceEditor
                    namespaces={loaded.schema.namespaces}
                    rootId={root.id}
                    showRootHeading
                    idPrefix="local-provisioning"
                    getvalue={editableFieldValue}
                    getvalidation={fieldValidationError}
                    onupdate={updateEditableField}
                    onvalidation={setFieldValidationError}
                    oncommand={requestProvisioningCommand}
                  />
                </div>
              {/each}
            </div>
            {#if dirtyFields.length > 0}
              <ProvisioningSaveBar
                sticky
                revertLabel={$t('provisioning.namespace.revert')}
                saveLabel={$t('rnodeMaintenance.provisioning.save', { count: dirtyFields.length })}
                revertDisabled={busy}
                saveDisabled={validationErrorCount > 0 || busy}
                onrevert={revertProvisioning}
                onsave={() => saveProvisioning()}
              />
            {/if}
          </div>
        </div>
      {/if}
    </section>
  {:else}
    <section class="rnode-maintenance-panel local-log-panel">
      <div class="rnode-maintenance-section-heading"><div><h2>{$t('rnodeMaintenance.logs.title')}</h2><p>{$t('rnodeMaintenance.logs.description')}</p></div></div>
      <DeviceLogViewer lines={deviceLogs} onclear={() => { deviceLogs = []; }} />
    </section>
  {/if}
</div>

{#if connectionDetailsOpen && connected && selectedDevice}
  <ModalDialog
    titleId="rnode-connection-details-title"
    className="interface-editor rnode-connection-dialog"
    onclose={() => { if (!busy) connectionDetailsOpen = false; }}
  >
    <header>
      <div class="section-icon"><Icon name={selectedDevice.transport === 'ble' ? 'bluetooth' : 'interface'} size={21} /></div>
      <div>
        <h2 id="rnode-connection-details-title">{$t('rnodeMaintenance.connection.title')}</h2>
        <p>{$t('rnodeMaintenance.connection.description')}</p>
      </div>
    </header>
    <div class="rnode-connection-dialog-content">
      <dl class="rnode-connection-details">
        <div>
          <dt>{$t('rnodeMaintenance.connection.transport')}</dt>
          <dd>{$t(`rnodeMaintenance.connection.${selectedDevice.transport}`)}</dd>
        </div>
        {#if connectionDeviceName(selectedDevice)}
          <div>
            <dt>{$t('rnodeMaintenance.connection.deviceName')}</dt>
            <dd>{connectionDeviceName(selectedDevice)}</dd>
          </div>
        {/if}
        <div>
          <dt>{$t(selectedDevice.transport === 'serial'
            ? 'rnodeMaintenance.connection.usbDevice'
            : 'rnodeMaintenance.connection.bleDeviceId')}</dt>
          <dd>{connectionIdentifier(selectedDevice)}</dd>
        </div>
        {#if selectedDevice.configuredInterface}
          <div>
            <dt>{$t('rnodeMaintenance.connection.configuredInterface')}</dt>
            <dd>{selectedDevice.configuredInterface.name}</dd>
          </div>
        {/if}
      </dl>
    </div>
    <footer>
      <button class="button secondary" type="button" disabled={busy} onclick={() => { connectionDetailsOpen = false; }}>
        {$t('common.close')}
      </button>
      <button class="button primary" type="button" disabled={busy} onclick={() => void disconnect()}>
        {$t('rnodeMaintenance.device.disconnect')}
      </button>
    </footer>
  </ModalDialog>
{/if}

{#if wipeEepromPending}
  <ConfirmationDialog titleId="rnode-wipe-eeprom" title={$t('rnodeMaintenance.confirm.wipe.title')} description={$t('rnodeMaintenance.confirm.wipe.description')} icon="trash" tone="danger" confirmLabel={$t('rnodeMaintenance.confirm.wipe.action')} oncancel={() => { wipeEepromPending = false; }} onconfirm={wipeEeprom} />
{:else if pendingDeviceAction === 'reboot'}
  <ConfirmationDialog titleId="rnode-local-reboot" title={$t('provisioning.reboot')} description={$t('provisioning.reboot.confirm')} icon="sync" confirmLabel={$t('provisioning.reboot')} oncancel={() => { pendingDeviceAction = undefined; }} onconfirm={rebootDevice} />
{:else if pendingDeviceAction === 'factoryReset'}
  <ConfirmationDialog titleId="rnode-local-factory-reset" title={$t('provisioning.factoryReset')} description={$t('provisioning.factoryReset.confirm')} icon="trash" tone="danger" confirmLabel={$t('provisioning.factoryReset')} oncancel={() => { pendingDeviceAction = undefined; }} onconfirm={factoryResetDevice} />
{:else if pendingCommand}
  <ConfirmationDialog titleId="rnode-local-command" title={$t('provisioning.command.dialog.title')} description={$t('provisioning.command.confirm', { name: pendingCommand.field.name })} icon="send" confirmLabel={$t('provisioning.command.send')} oncancel={() => { pendingCommand = undefined; }} onconfirm={sendProvisioningCommand} />
{/if}
