<script lang="ts">
  import { tick } from 'svelte';
  import type { ChatAttachment } from '../../domain/chat';
  import { formatChatByteSize } from '../../domain/chat-attachments';
  import { saveChatFile } from '../../infrastructure/platform/file-save';
  import { t } from '../../i18n';
  import Icon from '../../lib/components/Icon.svelte';
  import { toast } from '../../lib/notifications/toasts';

  let {
    attachment,
    onlayout,
  }: {
    attachment: ChatAttachment;
    onlayout?: () => void;
  } = $props();
  let objectUrl = $state('');
  let saving = $state(false);
  let viewerOpen = $state(false);
  let previewButton = $state<HTMLButtonElement>();
  let closeButton = $state<HTMLButtonElement>();

  $effect(() => {
    const url = URL.createObjectURL(new Blob([attachment.data as BlobPart], { type: attachment.mimeType }));
    objectUrl = url;
    return () => URL.revokeObjectURL(url);
  });

  $effect(() => {
    if (!viewerOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previousOverflow; };
  });

  function openViewer(): void {
    viewerOpen = true;
    void tick().then(() => closeButton?.focus());
  }

  function closeViewer(): void {
    viewerOpen = false;
    void tick().then(() => previewButton?.focus());
  }

  function viewerKeydown(event: KeyboardEvent): void {
    event.stopPropagation();
    if (event.key !== 'Escape') return;
    event.preventDefault();
    closeViewer();
  }

  async function save(): Promise<void> {
    if (saving) return;
    saving = true;
    try {
      if (!await saveChatFile(attachment.name, attachment.mimeType, attachment.data, attachment.kind)) {
        toast.error('chat.attachment.saveError');
      }
    } finally {
      saving = false;
    }
  }

  function attachmentLayoutReady(): void {
    onlayout?.();
  }

</script>

<div class="message-attachment" class:image={attachment.kind === 'image'}>
  <div class="message-file-copy">
    <Icon name={attachment.kind === 'image' ? 'image' : attachment.kind === 'audio' ? 'microphone' : 'file'} size={19} />
    <span><strong>{attachment.name}</strong><small>{formatChatByteSize(attachment.data.byteLength)}</small></span>
  </div>
  {#if attachment.kind === 'image'}
    <button
      bind:this={previewButton}
      type="button"
      class="message-attachment-image-button"
      title={$t('chat.attachment.openImage', { name: attachment.name })}
      aria-label={$t('chat.attachment.openImage', { name: attachment.name })}
      onclick={openViewer}
      onpointerdown={(event) => event.stopPropagation()}
      onkeydown={(event) => event.stopPropagation()}
    ><img src={objectUrl} alt={attachment.name} loading="lazy" onload={attachmentLayoutReady} /></button>
  {:else if attachment.kind === 'audio'}
    <audio src={objectUrl} controls preload="metadata" onloadedmetadata={attachmentLayoutReady}>
      {$t('chat.attachment.audioUnsupported')}
    </audio>
  {/if}
  <button
    type="button"
    class="message-attachment-save"
    disabled={saving}
    title={$t('chat.attachment.save', { name: attachment.name })}
    aria-label={$t('chat.attachment.save', { name: attachment.name })}
    onclick={save}
  ><Icon name="download" size={15} /><span>{$t('chat.attachment.saveAction')}</span></button>
</div>

{#if viewerOpen && attachment.kind === 'image'}
  <div
    class="message-image-viewer"
    role="dialog"
    tabindex="-1"
    aria-modal="true"
    aria-label={$t('chat.attachment.imageViewer', { name: attachment.name })}
    onkeydown={viewerKeydown}
    onpointerdown={(event) => event.stopPropagation()}
  >
    <button
      type="button"
      class="message-image-viewer-backdrop"
      aria-label={$t('common.close')}
      onclick={closeViewer}
    ></button>
    <div class="message-image-viewer-panel">
      <header>
        <span><Icon name="image" size={18} /><strong>{attachment.name}</strong></span>
        <button
          bind:this={closeButton}
          type="button"
          class="message-image-viewer-close"
          title={$t('common.close')}
          aria-label={$t('common.close')}
          onclick={closeViewer}
        ><Icon name="close" size={20} /></button>
      </header>
      <div class="message-image-viewer-stage">
        <img class="message-image-viewer-image" src={objectUrl} alt={attachment.name} />
      </div>
    </div>
  </div>
{/if}
