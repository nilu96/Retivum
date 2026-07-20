<script lang="ts">
  import { onMount, type Snippet } from 'svelte';
  import { t } from '../../i18n';
  import { lockBodyScroll } from '../actions/bodyScrollLock';
  import ModalCloseButton from './ModalCloseButton.svelte';

  let {
    titleId,
    onclose,
    children,
    className = 'interface-editor',
    role = 'dialog',
  }: {
    titleId: string;
    onclose: () => void;
    children: Snippet;
    className?: string;
    role?: 'dialog' | 'alertdialog';
  } = $props();

  onMount(() => {
    const handleKeydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onclose();
    };
    window.addEventListener('keydown', handleKeydown);
    return () => window.removeEventListener('keydown', handleKeydown);
  });
</script>

<div class="modal-layer" use:lockBodyScroll>
  <button
    type="button"
    class="modal-backdrop"
    aria-label={$t('common.close')}
    onclick={onclose}
  ></button>
  <div class={className} {role} aria-modal="true" aria-labelledby={titleId}>
    <ModalCloseButton label={$t('common.close')} onclick={onclose} />
    {@render children()}
  </div>
</div>
