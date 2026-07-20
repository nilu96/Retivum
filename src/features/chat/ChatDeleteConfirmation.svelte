<script lang="ts">
  import { t } from '../../i18n';
  import { lockBodyScroll } from '../../lib/actions/bodyScrollLock';
  import Icon from '../../lib/components/Icon.svelte';

  let {
    kind,
    chatName = '',
    oncancel,
    onconfirm,
  }: {
    kind: 'message' | 'conversation';
    chatName?: string;
    oncancel: () => void;
    onconfirm: () => Promise<void>;
  } = $props();

  let deleting = $state(false);
  const titleId = $derived(`chat-${kind}-delete-title`);
  const descriptionId = $derived(`chat-${kind}-delete-description`);

  function cancel(): void {
    if (!deleting) oncancel();
  }

  async function confirmDelete(): Promise<void> {
    if (deleting) return;
    deleting = true;
    try {
      await onconfirm();
    } finally {
      deleting = false;
    }
  }
</script>

<div class="modal-layer" use:lockBodyScroll>
  <button type="button" class="modal-backdrop" aria-label={$t('common.close')} onclick={cancel}></button>
  <div
    class="identity-name-editor"
    role="alertdialog"
    aria-modal="true"
    aria-labelledby={titleId}
    aria-describedby={descriptionId}
  >
    <header>
      <div class="section-icon danger"><Icon name={kind === 'conversation' ? 'chat' : 'trash'} size={21} /></div>
      <div>
        <h2 id={titleId}>{$t(kind === 'conversation'
          ? 'chat.conversation.deleteDialog.title'
          : 'chat.message.deleteDialog.title')}</h2>
        <p id={descriptionId}>{$t(kind === 'conversation'
          ? 'chat.conversation.deleteDialog.description'
          : 'chat.message.deleteDialog.description', { name: chatName })}</p>
      </div>
    </header>
    <footer class="identity-confirmation-actions">
      <button class="button secondary" type="button" disabled={deleting} onclick={cancel}>{$t('common.cancel')}</button>
      <button class="button danger" type="button" disabled={deleting} onclick={confirmDelete}>
        {deleting
          ? $t('common.loading')
          : $t(kind === 'conversation' ? 'chat.conversation.deleteDialog.confirm' : 'chat.message.actions.delete')}
      </button>
    </footer>
  </div>
</div>
