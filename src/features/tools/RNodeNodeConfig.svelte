<script lang="ts">
  import { onMount } from 'svelte';
  import type { ReticulumLogEntry, ReticulumLogLevel } from '../../domain/logging';
  import {
    type RNodeDisplayConfig,
    type RNodeMaintenanceSession,
    type RNodeRadioConfig,
    type RNodeWifiConfig,
  } from '../../infrastructure/platform/rnode-maintenance';
  import { t, type MessageKey } from '../../i18n';
  import ConfirmationDialog from '../../lib/components/ConfirmationDialog.svelte';
  import Icon from '../../lib/components/Icon.svelte';
  import { toast } from '../../lib/notifications/toasts';

  interface Props {
    session?: RNodeMaintenanceSession;
    bluetoothPin?: string;
    onlog?: (level: ReticulumLogLevel, code: string, details?: ReticulumLogEntry['details']) => void;
    onwipe?: () => void;
  }

  type DisplayDraft = Partial<RNodeDisplayConfig>;
  type WifiDraft = Partial<RNodeWifiConfig>;

  let { session, bluetoothPin = '', onlog = () => undefined, onwipe = () => undefined }: Props = $props();
  let busy = $state(false);
  let radio = $state<RNodeRadioConfig>();
  let persistedBootMode = $state<RNodeRadioConfig['bootMode']>();
  let eeprom = $state<Uint8Array>();
  let restoreFile = $state<File>();
  let restoreInput = $state<HTMLInputElement>();
  let display = $state<DisplayDraft>({});
  let wifi = $state<WifiDraft>({});
  const displayHasValue = $derived(Object.values(display).some((value) => value !== undefined));
  const wifiHasValue = $derived(Object.values(wifi).some((value) => value !== undefined));

  onMount(() => {
    if (session) void refreshRadio();
  });

  async function run(action: () => Promise<void>, success: MessageKey | undefined, code: string): Promise<boolean> {
    if (busy || !session) return false;
    busy = true;
    try {
      await action();
      if (success) toast.success(success);
      onlog('info', code);
      return true;
    } catch (error) {
      toast.error('rnodeMaintenance.nodeConfig.actionFailed');
      onlog('error', `${code}_FAILED`, { message: error instanceof Error ? error.message : String(error) });
      return false;
    } finally {
      busy = false;
    }
  }

  async function refreshRadio(showFeedback = false): Promise<void> {
    await run(async () => {
      const current = await session!.readRadioConfig();
      radio = current;
      persistedBootMode = current.bootMode;
      eeprom = await session!.readEeprom();
    }, showFeedback ? 'rnodeMaintenance.nodeConfig.radioLoaded' : undefined, 'RNODE_GENERAL_CONFIG_LOADED');
  }

  async function saveRadio(): Promise<void> {
    if (!radio) return;
    if (persistedBootMode !== radio.bootMode && !globalThis.confirm($t('rnodeMaintenance.nodeConfig.bootModeConfirm', { mode: radio.bootMode.toUpperCase() }))) return;
    if (await run(() => session!.saveRadioConfig(radio!), 'rnodeMaintenance.nodeConfig.radioSaved', 'RNODE_GENERAL_RADIO_SAVED')) {
      persistedBootMode = radio.bootMode;
    }
  }

  async function saveWifi(): Promise<void> {
    if (!wifiHasValue) return;
    const config: Partial<RNodeWifiConfig> = { ...wifi };
    await run(() => session!.saveWifiConfig(config), 'rnodeMaintenance.nodeConfig.wifiSaved', 'RNODE_WIFI_CONFIG_SAVED');
  }

  async function saveDisplay(): Promise<void> {
    if (!displayHasValue) return;
    const config: Partial<RNodeDisplayConfig> = { ...display };
    await run(() => session!.saveDisplayConfig(config), 'rnodeMaintenance.nodeConfig.displaySaved', 'RNODE_DISPLAY_CONFIG_SAVED');
  }

  function downloadEeprom(): void {
    if (!eeprom) return;
    const url = URL.createObjectURL(new Blob([eeprom.slice().buffer as ArrayBuffer], { type: 'application/octet-stream' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `rnode-eeprom-${new Date().toISOString().replace(/[:.]/g, '-')}.bin`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function selectRestoreFile(event: Event & { currentTarget: HTMLInputElement }): void {
    restoreFile = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
  }

  async function restoreEeprom(): Promise<void> {
    const file = restoreFile;
    restoreFile = undefined;
    if (!file || busy || !session) return;
    busy = true;
    try {
      const backup = new Uint8Array(await file.arrayBuffer());
      eeprom = await session.restoreEeprom(backup);
      toast.success('rnodeMaintenance.nodeConfig.eepromRestored');
      onlog('info', 'RNODE_EEPROM_RESTORED', { bytes: backup.byteLength });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const messageKey: MessageKey = message === 'RNODE_EEPROM_BACKUP_INVALID_SIZE' || message === 'RNODE_EEPROM_BACKUP_DEVICE_SIZE_MISMATCH'
        ? 'rnodeMaintenance.nodeConfig.eepromRestoreInvalidSize'
        : message === 'RNODE_EEPROM_LOCKED'
          ? 'rnodeMaintenance.nodeConfig.eepromRestoreLocked'
          : 'rnodeMaintenance.nodeConfig.eepromRestoreFailed';
      toast.error(messageKey);
      onlog('error', 'RNODE_EEPROM_RESTORE_FAILED', { message });
    } finally {
      busy = false;
    }
  }

</script>

<div class="rnode-node-config">
  {#if !session}
    <p class="rnode-maintenance-empty">{$t('rnodeMaintenance.nodeConfig.connectFirst')}</p>
  {:else}
    <div class="rnode-provisioning-sections rnode-node-config-sections">
      <section>
        <div class="rnode-config-card-heading"><div><h3>{$t('rnodeMaintenance.nodeConfig.radio')}</h3><p>{$t('rnodeMaintenance.nodeConfig.radioDescription')}</p></div><button class="button secondary" disabled={busy} onclick={() => void refreshRadio(true)}><Icon name="sync" size={16} />{$t('rnodeMaintenance.nodeConfig.refresh')}</button></div>
        {#if radio}
          <div class="rnode-provisioning-fields">
            <label class="field"><span>{$t('rnodeMaintenance.nodeConfig.bootMode')}</span><select bind:value={radio.bootMode}><option value="host">{$t('rnodeMaintenance.nodeConfig.hostMode')}</option><option value="tnc">{$t('rnodeMaintenance.nodeConfig.tncMode')}</option></select></label>
            <label class="field"><span>{$t('rnodeMaintenance.nodeConfig.frequency')}</span><input type="number" min="100000000" max="1100000000" disabled={radio.bootMode === 'host'} bind:value={radio.frequency} /><small>Hz</small></label>
            <label class="field"><span>{$t('rnodeMaintenance.nodeConfig.bandwidth')}</span><input type="number" min="7800" max="1625000" disabled={radio.bootMode === 'host'} bind:value={radio.bandwidth} /><small>Hz</small></label>
            <label class="field"><span>{$t('rnodeMaintenance.nodeConfig.sf')}</span><input type="number" min="5" max="12" disabled={radio.bootMode === 'host'} bind:value={radio.spreadingFactor} /></label>
            <label class="field"><span>{$t('rnodeMaintenance.nodeConfig.cr')}</span><input type="number" min="5" max="8" disabled={radio.bootMode === 'host'} bind:value={radio.codingRate} /></label>
            <label class="field"><span>{$t('rnodeMaintenance.nodeConfig.txPower')}</span><input type="number" min="-9" max="37" disabled={radio.bootMode === 'host'} bind:value={radio.txPower} /><small>dBm</small></label>
            <label class="field rnode-switch-field"><span>{$t('rnodeMaintenance.nodeConfig.ia')}</span><input type="checkbox" role="switch" disabled={radio.bootMode === 'host'} bind:checked={radio.interferenceAvoidance} /></label>
          </div>
          <aside class="rnode-maintenance-notice"><Icon name="info" size={18} /><p>{$t('rnodeMaintenance.nodeConfig.bootModeHelp')}</p></aside>
          <div class="rnode-maintenance-actions"><button class="button primary" disabled={busy} onclick={() => void saveRadio()}>{$t('rnodeMaintenance.nodeConfig.saveRadio')}</button></div>
        {:else}<p class="rnode-maintenance-empty">{$t('rnodeMaintenance.nodeConfig.radioPrompt')}</p>{/if}
      </section>

      <section>
        <div class="rnode-config-card-heading"><div><h3>{$t('rnodeMaintenance.nodeConfig.bluetooth')}</h3><p>{$t('rnodeMaintenance.nodeConfig.bluetoothDescription')}</p></div></div>
        <div class="rnode-maintenance-actions">
          <button class="button secondary" disabled={busy} onclick={() => void run(() => session.setBluetooth(0), 'rnodeMaintenance.nodeConfig.bluetoothOff', 'RNODE_BLUETOOTH_DISABLED')}>{$t('rnodeMaintenance.nodeConfig.turnOff')}</button>
          <button class="button secondary" disabled={busy} onclick={() => void run(() => session.setBluetooth(1), 'rnodeMaintenance.nodeConfig.bluetoothOn', 'RNODE_BLUETOOTH_ENABLED')}>{$t('rnodeMaintenance.nodeConfig.turnOn')}</button>
          <button class="button primary" disabled={busy} onclick={() => void run(() => session.setBluetooth(2), 'rnodeMaintenance.nodeConfig.pairing', 'RNODE_BLUETOOTH_PAIRING')}>{$t('rnodeMaintenance.nodeConfig.pair')}</button>
          <button class="button danger" disabled={busy} onclick={() => void run(() => session.unpairBluetooth(), 'rnodeMaintenance.nodeConfig.unpaired', 'RNODE_BLUETOOTH_UNPAIRED')}>{$t('rnodeMaintenance.nodeConfig.unpair')}</button>
        </div>
        {#if bluetoothPin}<p class="rnode-maintenance-help">{$t('rnodeMaintenance.nodeConfig.pin', { pin: bluetoothPin })}</p>{/if}
      </section>

      <section>
        <div class="rnode-config-card-heading"><div><h3>{$t('rnodeMaintenance.nodeConfig.wifi')}</h3><p>{$t('rnodeMaintenance.nodeConfig.wifiDescription')}</p></div></div>
        <div class="rnode-provisioning-fields">
          <label class="field"><span>{$t('rnodeMaintenance.nodeConfig.mode')}</span><select bind:value={wifi.mode}><option value={undefined}></option><option value={0}>{$t('rnodeMaintenance.nodeConfig.off')}</option><option value={1}>{$t('rnodeMaintenance.nodeConfig.station')}</option><option value={2}>{$t('rnodeMaintenance.nodeConfig.accessPoint')}</option></select></label>
          <label class="field"><span>{$t('rnodeMaintenance.nodeConfig.channel')}</span><input type="number" min="1" max="13" bind:value={wifi.channel} /></label>
          <label class="field"><span>{$t('rnodeMaintenance.nodeConfig.ssid')}</span><input maxlength="32" bind:value={wifi.ssid} /></label>
          <label class="field"><span>{$t('rnodeMaintenance.nodeConfig.psk')}</span><input type="password" maxlength="32" bind:value={wifi.psk} /></label>
          <label class="field"><span>{$t('rnodeMaintenance.nodeConfig.ip')}</span><input inputmode="numeric" bind:value={wifi.ip} /></label>
          <label class="field"><span>{$t('rnodeMaintenance.nodeConfig.netmask')}</span><input inputmode="numeric" bind:value={wifi.netmask} /></label>
        </div>
        <aside class="rnode-maintenance-notice"><Icon name="info" size={18} /><p>{$t('rnodeMaintenance.nodeConfig.setOnly')}</p></aside>
        <div class="rnode-maintenance-actions"><button class="button primary" disabled={busy || !wifiHasValue} onclick={() => void saveWifi()}>{$t('rnodeMaintenance.nodeConfig.saveWifi')}</button></div>
      </section>

      <section>
        <div class="rnode-config-card-heading"><div><h3>{$t('rnodeMaintenance.nodeConfig.display')}</h3><p>{$t('rnodeMaintenance.nodeConfig.displayDescription')}</p></div></div>
        <div class="rnode-provisioning-fields">
          <label class="field"><span>{$t('rnodeMaintenance.nodeConfig.intensity')}</span><input type="number" min="0" max="255" bind:value={display.intensity} /></label>
          <label class="field"><span>{$t('rnodeMaintenance.nodeConfig.blanking')}</span><input type="number" min="0" max="255" bind:value={display.blankingTimeout} /></label>
          <label class="field"><span>{$t('rnodeMaintenance.nodeConfig.rotation')}</span><select bind:value={display.rotation}><option value={undefined}></option><option value={0}>0°</option><option value={1}>90°</option><option value={2}>180°</option><option value={3}>270°</option></select></label>
          <label class="field"><span>{$t('rnodeMaintenance.nodeConfig.address')}</span><input type="number" min="0" max="255" bind:value={display.address} /></label>
          <label class="field"><span>{$t('rnodeMaintenance.nodeConfig.neopixel')}</span><input type="number" min="0" max="255" bind:value={display.neopixelIntensity} /></label>
        </div>
        <aside class="rnode-maintenance-notice"><Icon name="info" size={18} /><p>{$t('rnodeMaintenance.nodeConfig.setOnly')}</p></aside>
        <div class="rnode-maintenance-actions"><button class="button primary" disabled={busy || !displayHasValue} onclick={() => void saveDisplay()}>{$t('rnodeMaintenance.nodeConfig.saveDisplay')}</button></div>
      </section>

      <section>
        <div class="rnode-config-card-heading"><div><h3>{$t('rnodeMaintenance.nodeConfig.eeprom')}</h3><p>{$t('rnodeMaintenance.nodeConfig.eepromDescription')}</p></div></div>
        <div class="rnode-maintenance-actions"><button class="button secondary" disabled={!eeprom} onclick={downloadEeprom}>{$t('rnodeMaintenance.nodeConfig.backupEeprom')}</button><input bind:this={restoreInput} class="sr-only" type="file" accept=".bin,application/octet-stream" aria-label={$t('rnodeMaintenance.nodeConfig.restoreFileLabel')} onchange={selectRestoreFile} /><button class="button secondary" disabled={busy} onclick={() => restoreInput?.click()}>{$t('rnodeMaintenance.nodeConfig.restoreEeprom')}</button><button class="button danger" disabled={busy} onclick={onwipe}>{$t('rnodeMaintenance.nodeConfig.wipeEeprom')}</button></div>
      </section>
    </div>
  {/if}
</div>

{#if restoreFile}
  <ConfirmationDialog
    titleId="rnode-restore-eeprom"
    title={$t('rnodeMaintenance.confirm.restore.title')}
    description={$t('rnodeMaintenance.confirm.restore.description', { name: restoreFile.name })}
    icon="upload"
    tone="danger"
    confirmLabel={$t('rnodeMaintenance.confirm.restore.action')}
    oncancel={() => { restoreFile = undefined; }}
    onconfirm={restoreEeprom}
  />
{/if}
