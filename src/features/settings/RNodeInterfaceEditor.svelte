<script lang="ts">
  import {
    createRNodeInterfaceDraft,
    AUTHORIZED_SERIAL_PORT_ID,
    rnodeBandwidths,
    validateRNodeInterface,
    type InterfaceConfig,
    type InterfaceValidationCode,
    type RNodeConnectionType,
    type RNodeInterfaceConfig,
  } from '../../domain/settings';
  import { t, type MessageKey } from '../../i18n';
  import { authorizeRNodeDevice, selectRNodeDevice } from '../../infrastructure/platform/interface-capabilities';
  import Icon from '../../lib/components/Icon.svelte';
  import ModalDialog from '../../lib/components/ModalDialog.svelte';
  import { toast } from '../../lib/notifications/toasts';
  import InterfaceAdvancedSettings from './InterfaceAdvancedSettings.svelte';

  let { config, connections, unavailableDeviceIds = [], oncancel, onsave }: {
    config?: RNodeInterfaceConfig;
    connections: RNodeConnectionType[];
    unavailableDeviceIds?: string[];
    oncancel: () => void;
    onsave: (config: InterfaceConfig) => Promise<void> | void;
  } = $props();

  const connectionLabels: Record<RNodeConnectionType, MessageKey> = {
    ble: 'interface.editor.rnode.connection.ble',
    serial: 'interface.editor.rnode.connection.serial',
  };
  let draft = $state(createRNodeInterfaceDraft('ble'));
  let errors = $state<InterfaceValidationCode[]>([]);
  let saving = $state(false);
  let selecting = $state(false);
  let pairing = $state(false);

  $effect.pre(() => {
    if (config && draft.id !== config.id) {
      draft = { ...config, connection: { ...config.connection }, radio: { ...config.radio } };
    } else if (!config && !connections.includes(draft.connection.type)) {
      draft = createRNodeInterfaceDraft(connections[0] ?? 'ble');
    }
  });

  function changeConnection(type: RNodeConnectionType): void {
    draft.connection = { type };
  }

  async function selectDevice(): Promise<void> {
    selecting = true;
    try {
      const device = await selectRNodeDevice(draft.connection.type);
      draft.connection = { type: draft.connection.type, ...device };
      if (device.deviceId && unavailableDeviceIds.includes(device.deviceId)) {
        toast.error('settings.interfaces.rnodeDeviceInUse');
        return;
      }
    } catch (error) {
      const code = error instanceof Error ? error.message : '';
      if (code === 'RNODE_BLE_SELECTION_CANCELLED') return;
      if (code === 'RNODE_BLE_PERMISSION_DENIED') toast.error('interface.editor.rnode.device.permissionDenied');
      else if (code === 'RNODE_BLE_DISABLED') toast.error('interface.editor.rnode.device.bluetoothDisabled');
      else if (code === 'RNODE_BLE_UNAVAILABLE') toast.error('interface.editor.rnode.device.bluetoothUnavailable');
      else toast.error('interface.editor.rnode.device.error');
      return;
    } finally {
      selecting = false;
    }

    pairing = true;
    try {
      await authorizeRNodeDevice(draft.connection.type, draft.connection.deviceId);
    } catch {
      toast.error('interface.editor.rnode.device.pairingError');
    } finally {
      pairing = false;
    }
  }

  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (selecting || pairing) return;
    errors = validateRNodeInterface(draft);
    if (errors.length > 0) return;
    saving = true;
    try {
      draft.name = draft.name.trim();
      await onsave($state.snapshot(draft));
    } finally {
      saving = false;
    }
  }

  function selectedDeviceName(): string {
    if (draft.connection.deviceId === AUTHORIZED_SERIAL_PORT_ID) {
      return $t('interface.editor.rnode.device.authorizedSerial');
    }
    return draft.connection.deviceName ?? $t('interface.editor.rnode.device.none');
  }
</script>

<ModalDialog titleId="rnode-editor-title" onclose={oncancel}>
    <header>
      <div class="section-icon"><Icon name="radio" size={21} /></div>
      <div>
        <h2 id="rnode-editor-title">{$t(config ? 'interface.editor.rnode.editTitle' : 'interface.editor.rnode.title')}</h2>
        <p>{$t('interface.editor.rnode.notice')}</p>
      </div>
    </header>
    <form onsubmit={submit}>
      {#if errors.length > 0}
        <div class="validation-summary" role="alert">
          {#each errors as error}<p>{$t(error)}</p>{/each}
        </div>
      {/if}
      <label class="field full-width">
        <span>{$t('interface.editor.name')}</span>
        <input bind:value={draft.name} placeholder={$t('interface.editor.name.placeholder')} autocomplete="off" />
      </label>
      <div class="field-grid interface-editor-grid rnode-connection-grid">
        <label class="field">
          <span>{$t('interface.editor.rnode.connection')}</span>
          <select value={draft.connection.type} onchange={(event) => changeConnection(event.currentTarget.value as RNodeConnectionType)}>
            {#each connections as connection}<option value={connection}>{$t(connectionLabels[connection])}</option>{/each}
          </select>
        </label>
        <div class="field">
          <span>{$t('interface.editor.rnode.device')}</span>
          <button class="button secondary rnode-device-button" type="button" disabled={selecting || pairing} onclick={selectDevice}>
            {selecting
              ? $t('interface.editor.rnode.device.selecting')
              : pairing
                ? $t('interface.editor.rnode.device.pairing')
                : $t('interface.editor.rnode.device.select')}
          </button>
          <small>{selectedDeviceName()}</small>
        </div>
      </div>
      <div class="field-grid interface-editor-grid rnode-radio-grid">
        <label class="field"><span>{$t('interface.editor.rnode.frequency')}</span><input type="number" min="137000000" max="3000000000" step="100" bind:value={draft.radio.frequency} /></label>
        <label class="field"><span>{$t('interface.editor.rnode.bandwidth')}</span><select bind:value={draft.radio.bandwidth}>{#each rnodeBandwidths as bandwidth}<option value={bandwidth}>{bandwidth}</option>{/each}</select></label>
        <label class="field"><span>{$t('interface.editor.rnode.txPower')}</span><input type="number" min="0" max="37" bind:value={draft.radio.txPower} /></label>
        <label class="field"><span>{$t('interface.editor.rnode.spreadingFactor')}</span><input type="number" min="5" max="12" bind:value={draft.radio.spreadingFactor} /></label>
        <label class="field"><span>{$t('interface.editor.rnode.codingRate')}</span><input type="number" min="5" max="8" bind:value={draft.radio.codingRate} /></label>
      </div>
      <label class="field full-width rnode-duty-cycle">
        <span>{$t('interface.editor.rnode.dutyCycle')}</span>
        <div class="rnode-duty-cycle-controls">
          <input type="range" min="0" max="99" step="1" bind:value={draft.radio.dutyCycle} />
          <div class="percentage-input">
            <input type="number" min="0" max="99" step="1" bind:value={draft.radio.dutyCycle} />
            <span aria-hidden="true">%</span>
          </div>
        </div>
        <small>{$t('interface.editor.rnode.dutyCycle.help')}</small>
      </label>
      <label class="toggle-row"><span><strong>{$t('interface.editor.rnode.flowControl')}</strong></span><input type="checkbox" role="switch" bind:checked={draft.radio.flowControl} /></label>
      <div class="interface-editor-final-settings">
        <label class="toggle-row"><span><strong>{$t('interface.editor.enabled')}</strong></span><input type="checkbox" role="switch" bind:checked={draft.enabled} /></label>
        <InterfaceAdvancedSettings mode={draft.mode} onchange={(mode) => { draft.mode = mode; }} />
      </div>
      <footer>
        <button class="button secondary" type="button" onclick={oncancel}>{$t('common.cancel')}</button>
        <button class="button primary" type="submit" disabled={saving || selecting || pairing}>{saving ? $t('common.loading') : $t('common.save')}</button>
      </footer>
    </form>
</ModalDialog>
