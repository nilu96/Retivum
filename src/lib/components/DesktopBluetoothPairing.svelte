<script lang="ts">
  import { onMount } from 'svelte';
  import { t } from '../../i18n';
  import { lockBodyScroll } from '../actions/bodyScrollLock';
  import Icon from './Icon.svelte';
  import ModalCloseButton from './ModalCloseButton.svelte';

  let { request, onrespond }: {
    request: DesktopBluetoothPairingRequest;
    onrespond: (confirmed: boolean, pin?: string) => void;
  } = $props();

  let pin = $state('');
  let pinInput = $state<HTMLInputElement>();

  onMount(() => {
    if (request.pairingKind === 'providePin') pinInput?.focus({ preventScroll: true });
  });

  function validPin(): boolean {
    return /^[0-9]{6}$/.test(pin.trim());
  }

  function confirm(): void {
    if (request.pairingKind === 'providePin' && !validPin()) return;
    onrespond(true, request.pairingKind === 'providePin' ? pin.trim() : undefined);
  }

  function updatePin(event: Event): void {
    pin = (event.currentTarget as HTMLInputElement).value.replace(/\D/g, '').slice(0, 6);
  }
</script>

<div class="modal-layer bluetooth-pairing-layer" use:lockBodyScroll>
  <button type="button" class="modal-backdrop" aria-label={$t('common.close')} onclick={() => onrespond(false)}></button>
  <div
    class="identity-name-editor bluetooth-pairing-dialog"
    role="dialog"
    aria-modal="true"
    aria-labelledby="bluetooth-pairing-title"
    aria-describedby="bluetooth-pairing-description"
  >
    <ModalCloseButton label={$t('common.close')} onclick={() => onrespond(false)} />
    <header>
      <div class="section-icon bluetooth-pairing-icon"><Icon name="shield" size={24} /></div>
      <div>
        <span class="bluetooth-pairing-eyebrow">{$t('desktop.bluetooth.pairing.secure')}</span>
        <h2 id="bluetooth-pairing-title">{$t('desktop.bluetooth.pairing.title')}</h2>
        <p id="bluetooth-pairing-description">{$t(`desktop.bluetooth.pairing.${request.pairingKind}.description`)}</p>
      </div>
    </header>

    {#if request.pairingKind === 'providePin'}
      <form class="bluetooth-pairing-form" onsubmit={(event) => { event.preventDefault(); confirm(); }}>
        <div class="bluetooth-pairing-code-panel">
          <div class="bluetooth-pairing-code-label">
            <label for="bluetooth-pairing-pin">{$t('desktop.bluetooth.pairing.pin')}</label>
            <small id="bluetooth-pairing-pin-hint">{$t('desktop.bluetooth.pairing.pinHint')}</small>
          </div>
          <input
            bind:this={pinInput}
            id="bluetooth-pairing-pin"
            value={pin}
            inputmode="numeric"
            pattern="[0-9]*"
            minlength="6"
            maxlength="6"
            autocomplete="one-time-code"
            aria-describedby="bluetooth-pairing-pin-hint bluetooth-pairing-privacy"
            oninput={updatePin}
            required
          />
          <p id="bluetooth-pairing-privacy" class="bluetooth-pairing-privacy">
            <Icon name="shield" size={15} />
            <span>{$t('desktop.bluetooth.pairing.privacy')}</span>
          </p>
        </div>
        <footer class="bluetooth-pairing-actions">
          <button class="button secondary" type="button" onclick={() => onrespond(false)}>{$t('common.cancel')}</button>
          <button class="button primary" type="submit" disabled={!validPin()}>{$t('desktop.bluetooth.pairing.pair')}</button>
        </footer>
      </form>
    {:else}
      <div class="bluetooth-pairing-confirmation">
        {#if request.pairingKind === 'confirmPin'}
          <span>{$t('desktop.bluetooth.pairing.pin')}</span>
          <output class="bluetooth-pairing-pin" aria-label={$t('desktop.bluetooth.pairing.pin')}>{request.pin}</output>
        {/if}
        <p class="bluetooth-pairing-privacy">
          <Icon name="shield" size={15} />
          <span>{$t('desktop.bluetooth.pairing.privacy')}</span>
        </p>
      </div>
      <footer class="bluetooth-pairing-actions">
        <button class="button secondary" type="button" onclick={() => onrespond(false)}>{$t('common.cancel')}</button>
        <button class="button primary" type="button" onclick={confirm}>{$t('desktop.bluetooth.pairing.confirm')}</button>
      </footer>
    {/if}
  </div>
</div>
