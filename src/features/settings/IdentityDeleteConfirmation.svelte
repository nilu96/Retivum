<script lang="ts">
  import { t } from '../../i18n';
  import { lockBodyScroll } from '../../lib/actions/bodyScrollLock';
  import Icon from '../../lib/components/Icon.svelte';

  let {
    identityName,
    oncancel,
    onconfirm,
  }: {
    identityName: string;
    oncancel: () => void;
    onconfirm: () => Promise<void>;
  } = $props();

  let deleting = $state(false);

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
  <button type="button" class="modal-backdrop" aria-label={$t('common.close')} onclick={oncancel}></button>
  <div class="identity-name-editor" role="alertdialog" aria-modal="true" aria-labelledby="identity-delete-title" aria-describedby="identity-delete-description">
    <header>
      <div class="section-icon danger"><Icon name="identity" size={21} /></div>
      <div>
        <h2 id="identity-delete-title">{$t('settings.identity.deleteDialog.title')}</h2>
        <p id="identity-delete-description">{$t('settings.identity.deleteConfirm', { name: identityName })}</p>
      </div>
    </header>
    <footer class="identity-confirmation-actions">
      <button class="button secondary" type="button" disabled={deleting} onclick={oncancel}>{$t('common.cancel')}</button>
      <button class="button danger" type="button" disabled={deleting} onclick={confirmDelete}>
        {deleting ? $t('common.loading') : $t('settings.identity.delete')}
      </button>
    </footer>
  </div>
</div>
