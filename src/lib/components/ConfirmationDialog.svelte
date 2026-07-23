<script lang="ts">
  import { t } from '../../i18n';
  import { lockBodyScroll } from '../actions/bodyScrollLock';
  import Icon, { type IconName } from './Icon.svelte';

  let {
    titleId,
    title,
    description,
    icon,
    cancelLabel,
    confirmLabel,
    tone = 'primary',
    oncancel,
    onconfirm,
  }: {
    titleId: string;
    title: string;
    description: string;
    icon: IconName;
    cancelLabel?: string;
    confirmLabel: string;
    tone?: 'primary' | 'danger';
    oncancel: () => void;
    onconfirm: () => void | Promise<void>;
  } = $props();

  let confirming = $state(false);
  const descriptionId = $derived(`${titleId}-description`);

  function cancel(): void {
    if (!confirming) oncancel();
  }

  async function confirm(): Promise<void> {
    if (confirming) return;
    confirming = true;
    try {
      await onconfirm();
    } finally {
      confirming = false;
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
      <div class="section-icon" class:danger={tone === 'danger'}><Icon name={icon} size={21} /></div>
      <div>
        <h2 id={titleId}>{title}</h2>
        <p id={descriptionId}>{description}</p>
      </div>
    </header>
    <footer class="identity-confirmation-actions">
      <button class="button secondary" type="button" disabled={confirming} onclick={cancel}>
        {cancelLabel ?? $t('common.cancel')}
      </button>
      <button
        class="button"
        class:primary={tone === 'primary'}
        class:danger={tone === 'danger'}
        type="button"
        disabled={confirming}
        onclick={confirm}
      >
        {confirming ? $t('common.loading') : confirmLabel}
      </button>
    </footer>
  </div>
</div>
