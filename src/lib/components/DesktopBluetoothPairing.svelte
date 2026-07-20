<script lang="ts">
  import { t } from '../../i18n';
  import { lockBodyScroll } from '../actions/bodyScrollLock';
  import Icon from './Icon.svelte';

  let { request, onrespond }: {
    request: DesktopBluetoothPairingRequest;
    onrespond: (confirmed: boolean, pin?: string) => void;
  } = $props();

  let pin = $state('');

  function confirm(): void {
    if (request.pairingKind === 'providePin' && !pin.trim()) return;
    onrespond(true, request.pairingKind === 'providePin' ? pin.trim() : undefined);
  }
</script>

<div class="modal-layer" use:lockBodyScroll>
  <button type="button" class="modal-backdrop" aria-label={$t('common.close')} onclick={() => onrespond(false)}></button>
  <div class="identity-name-editor" role="dialog" aria-modal="true" aria-labelledby="bluetooth-pairing-title">
    <header>
      <div class="section-icon"><Icon name="radio" size={21} /></div>
      <div>
        <h2 id="bluetooth-pairing-title">{$t('desktop.bluetooth.pairing.title')}</h2>
        <p>{$t(`desktop.bluetooth.pairing.${request.pairingKind}.description`)}</p>
      </div>
    </header>

    {#if request.pairingKind === 'providePin'}
      <form onsubmit={(event) => { event.preventDefault(); confirm(); }}>
        <label>
          <span>{$t('desktop.bluetooth.pairing.pin')}</span>
          <input bind:value={pin} inputmode="numeric" autocomplete="one-time-code" />
        </label>
        <footer>
          <button class="button secondary" type="button" onclick={() => onrespond(false)}>{$t('common.cancel')}</button>
          <button class="button primary" type="submit" disabled={!pin.trim()}>{$t('desktop.bluetooth.pairing.pair')}</button>
        </footer>
      </form>
    {:else}
      {#if request.pairingKind === 'confirmPin'}
        <div class="bluetooth-pairing-pin" aria-label={$t('desktop.bluetooth.pairing.pin')}>{request.pin}</div>
      {/if}
      <footer class="identity-confirmation-actions">
        <button class="button secondary" type="button" onclick={() => onrespond(false)}>{$t('common.cancel')}</button>
        <button class="button primary" type="button" onclick={confirm}>{$t('desktop.bluetooth.pairing.confirm')}</button>
      </footer>
    {/if}
  </div>
</div>
