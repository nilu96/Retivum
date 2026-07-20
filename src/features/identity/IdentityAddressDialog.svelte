<script lang="ts">
  import { onMount } from 'svelte';
  import QRCode from 'qrcode';
  import { t } from '../../i18n';
  import Icon from '../../lib/components/Icon.svelte';
  import ModalDialog from '../../lib/components/ModalDialog.svelte';
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

  async function copyAddress(): Promise<void> {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(address);
      } else {
        const input = document.createElement('textarea');
        input.value = address;
        input.style.position = 'fixed';
        input.style.opacity = '0';
        document.body.append(input);
        input.select();
        const copiedWithFallback = document.execCommand('copy');
        input.remove();
        if (!copiedWithFallback) throw new Error('COPY_FAILED');
      }
      toast.success('common.copied');
    } catch {
      toast.error('common.copyFailed');
    }
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
          <dd><code>{destinationHash}</code></dd>
        </div>
        <div>
          <dt>{$t('identity.address.lxma')}</dt>
          <dd><code>{address}</code></dd>
        </div>
      </dl>

      <footer>
        <button class="button primary" type="button" onclick={copyAddress}>
          <Icon name="copy" size={17} />
          {$t('common.copy')}
        </button>
      </footer>
    </div>
</ModalDialog>
