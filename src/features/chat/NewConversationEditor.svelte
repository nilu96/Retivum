<script lang="ts">
  import { onDestroy, tick } from 'svelte';
  import { BrowserQRCodeReader, type IScannerControls } from '@zxing/browser';
  import { parseLxmaAddress } from '../../domain/lxmf';
  import { normalizeDestinationHash } from '../../domain/settings';
  import { t } from '../../i18n';
  import { reticulumRuntime } from '../../infrastructure/reticulum/runtime';
  import { lockBodyScroll } from '../../lib/actions/bodyScrollLock';
  import Icon from '../../lib/components/Icon.svelte';
  import { toast } from '../../lib/notifications/toasts';

  let { oncancel, onopen }: { oncancel: () => void; onopen: (destinationHash: string) => void } = $props();
  let destination = $state('');
  let scannerVideo = $state<HTMLVideoElement>();
  let scanning = $state(false);
  let submitting = $state(false);
  let scanProcessing = false;
  let scannerControls: IScannerControls | undefined;
  let scannerSession = 0;
  let lastInvalidValue = '';
  let lastInvalidAt = 0;
  const normalized = $derived(normalizeDestinationHash(destination));
  const lxmaAddress = $derived(parseLxmaAddress(destination));

  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (normalized) {
      onopen(normalized);
      return;
    }
    if (!lxmaAddress || submitting) return;
    submitting = true;
    try {
      const destinationHash = await reticulumRuntime.importLxmaPeer(destination);
      if (destinationHash) onopen(destinationHash);
      else toast.error('chat.new.destination.lxmaInvalid');
    } finally {
      submitting = false;
    }
  }

  function stopScanner(): void {
    scannerSession += 1;
    scannerControls?.stop();
    scannerControls = undefined;
    scanning = false;
    scanProcessing = false;
  }

  function showInvalidScan(value: string): void {
    const now = Date.now();
    if (value !== lastInvalidValue || now - lastInvalidAt > 2_500) {
      toast.error('chat.new.scan.invalid');
      lastInvalidValue = value;
      lastInvalidAt = now;
    }
  }

  async function handleScan(value: string, controls: IScannerControls): Promise<void> {
    if (scanProcessing) return;
    scanProcessing = true;
    const destinationHash = await reticulumRuntime.importLxmaPeer(value);
    if (!destinationHash) {
      showInvalidScan(value);
      scanProcessing = false;
      return;
    }

    controls.stop();
    scannerControls = undefined;
    scanning = false;
    onopen(destinationHash);
  }

  async function startScanner(): Promise<void> {
    if (scanning) {
      stopScanner();
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      toast.error('chat.new.scan.cameraError');
      return;
    }

    const session = ++scannerSession;
    scanning = true;
    await tick();
    if (!scannerVideo || session !== scannerSession) return;

    try {
      const reader = new BrowserQRCodeReader(undefined, { delayBetweenScanAttempts: 120 });
      const controls = await reader.decodeFromConstraints(
        { audio: false, video: { facingMode: { ideal: 'environment' } } },
        scannerVideo,
        (result, _error, activeControls) => {
          if (result) void handleScan(result.getText(), activeControls);
        },
      );
      if (session !== scannerSession) {
        controls.stop();
        return;
      }
      scannerControls = controls;
    } catch {
      if (session === scannerSession) {
        stopScanner();
        toast.error('chat.new.scan.cameraError');
      }
    }
  }

  onDestroy(stopScanner);
</script>

<div class="modal-layer" use:lockBodyScroll>
  <button type="button" class="modal-backdrop" aria-label={$t('common.close')} onclick={oncancel}></button>
  <div class="identity-name-editor" role="dialog" aria-modal="true" aria-labelledby="new-conversation-title">
    <header>
      <div class="section-icon"><Icon name="chat" size={21} /></div>
      <div>
        <h2 id="new-conversation-title">{$t('chat.new.title')}</h2>
        <p>{$t('chat.new.description')}</p>
      </div>
    </header>
    <form onsubmit={submit}>
      <div class="field">
        <label for="new-conversation-destination">{$t('chat.new.destination')}</label>
        <div class="new-conversation-destination-row">
          <input
            id="new-conversation-destination"
            bind:value={destination}
            maxlength="512"
            placeholder={$t('chat.new.destination.placeholder')}
            autocapitalize="none"
            autocomplete="off"
            spellcheck="false"
          />
          <button
            class="icon-button new-conversation-scan-button"
            class:active={scanning}
            type="button"
            aria-label={$t(scanning ? 'chat.new.scan.stop' : 'chat.new.scan.action')}
            title={$t(scanning ? 'chat.new.scan.stop' : 'chat.new.scan.action')}
            aria-pressed={scanning}
            onclick={startScanner}
          ><Icon name={scanning ? 'close' : 'qr-scan'} size={22} /></button>
        </div>
        <small>{$t('chat.new.destination.help')}</small>
      </div>
      {#if scanning}
        <div class="new-conversation-scanner" aria-label={$t('chat.new.scan.preview')}>
          <video bind:this={scannerVideo} autoplay muted playsinline></video>
          <div class="new-conversation-scan-frame" aria-hidden="true"></div>
          <span>{$t('chat.new.scan.hint')}</span>
        </div>
      {/if}
      {#if destination.trim() && !normalized && !lxmaAddress}
        <div class="validation-summary" role="alert"><p>{$t('chat.new.destination.invalid')}</p></div>
      {/if}
      <footer>
        <button class="button secondary" type="button" onclick={oncancel}>{$t('common.cancel')}</button>
        <button class="button primary" type="submit" disabled={submitting || (!normalized && !lxmaAddress)}>
          {$t('chat.new.open')}
        </button>
      </footer>
    </form>
  </div>
</div>
