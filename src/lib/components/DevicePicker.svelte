<script lang="ts">
  import { t, type MessageKey } from '../../i18n';
  import { lockBodyScroll } from '../actions/bodyScrollLock';
  import Icon from './Icon.svelte';
  import ModalCloseButton from './ModalCloseButton.svelte';

  interface DevicePickerRequest {
    devices: Array<{ id: string; name: string; detail?: string }>;
  }

  let { request, titleKey, descriptionKey, statusKey, onselect }: {
    request: DevicePickerRequest;
    titleKey: MessageKey;
    descriptionKey: MessageKey;
    statusKey?: MessageKey;
    onselect: (deviceId?: string) => void;
  } = $props();
</script>

<div class="modal-layer device-picker-layer" use:lockBodyScroll>
  <button type="button" class="modal-backdrop" aria-label={$t('common.close')} onclick={() => onselect()}></button>
  <div class="identity-name-editor device-picker" role="dialog" aria-modal="true" aria-labelledby="device-picker-title">
    <ModalCloseButton label={$t('common.close')} onclick={() => onselect()} />
    <header>
      <div class="section-icon"><Icon name="radio" size={21} /></div>
      <div>
        <h2 id="device-picker-title">{$t(titleKey)}</h2>
        <p>{$t(descriptionKey)}</p>
      </div>
    </header>
    <div class="device-picker-list">
      {#each request.devices as device (device.id)}
        <button class="button secondary" type="button" onclick={() => onselect(device.id)}>
          <strong>{device.name}</strong>
          {#if device.detail}<small>{device.detail}</small>{/if}
        </button>
      {:else}
        {#if statusKey}
          <p class="device-scan-status">{$t(statusKey)}</p>
        {/if}
      {/each}
    </div>
    <footer class="identity-confirmation-actions">
      <button class="button secondary" type="button" onclick={() => onselect()}>{$t('common.cancel')}</button>
    </footer>
  </div>
</div>
