<script lang="ts">
  import { onMount } from 'svelte';
  import QRCode from 'qrcode';
  import { t } from '../../i18n';
  import Icon from '../../lib/components/Icon.svelte';
  import ModalDialog from '../../lib/components/ModalDialog.svelte';
  import { copyText } from '../../lib/clipboard';
  import { toast } from '../../lib/notifications/toasts';

  let {
    address,
    destinationHash,
    onclose,
  }: {
    address: string;
    destinationHash: string;
    onclose: () => void;
  } = $props();

  let canvas = $state<HTMLCanvasElement>();
  let qrFailed = $state(false);

  onMount(() => {
    if (canvas) {
      void QRCode.toCanvas(canvas, address, {
        width: 320,
        margin: 2,
        errorCorrectionLevel: 'M',
        color: { dark: '#000000', light: '#ffffff' },
      }).catch(() => { qrFailed = true; });
    }
  });

  async function copyValue(value: string): Promise<void> {
    if (await copyText(value)) toast.success('common.copied');
    else toast.error('common.copyFailed');
  }
</script>

<ModalDialog titleId="identity-address-title" {onclose}>
    <header>
      <div class="section-icon"><Icon name="qr" size={21} /></div>
      <div>
        <h2 id="identity-address-title">{$t('identity.address.title')}</h2>
        <p>{$t('identity.address.description')}</p>
      </div>
    </header>

    <div class="identity-address-content">
      <div class="identity-qr">
        {#if qrFailed}
          <div class="inline-error" role="alert">{$t('identity.address.qrError')}</div>
        {:else}
          <canvas bind:this={canvas} aria-label={$t('identity.address.qrLabel')}></canvas>
        {/if}
      </div>

      <dl class="identity-address-details">
        <div>
          <dt>{$t('identity.address.destinationHash')}</dt>
          <dd>
            <button
              class="identity-address-copy"
              type="button"
              title={$t('identity.address.copyDestinationHash')}
              aria-label={$t('identity.address.copyDestinationHash')}
              onclick={() => copyValue(destinationHash)}
            ><code>{destinationHash}</code><Icon name="copy" size={17} /></button>
          </dd>
        </div>
        <div>
          <dt>{$t('identity.address.lxma')}</dt>
          <dd>
            <button
              class="identity-address-copy"
              type="button"
              title={$t('identity.address.copyLxma')}
              aria-label={$t('identity.address.copyLxma')}
              onclick={() => copyValue(address)}
            ><code>{address}</code><Icon name="copy" size={17} /></button>
          </dd>
        </div>
      </dl>
    </div>
</ModalDialog>
