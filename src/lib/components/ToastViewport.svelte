<script lang="ts">
  import { t } from '../../i18n';
  import { dismissToast, toasts } from '../notifications/toasts';
  import Icon from './Icon.svelte';
</script>

<section class="toast-viewport" aria-label={$t('toast.region.label')}>
  {#each $toasts as notification (notification.id)}
    <article
      class="toast-notification"
      class:success={notification.kind === 'success'}
      class:error={notification.kind === 'error'}
      role={notification.kind === 'error' ? 'alert' : 'status'}
    >
      <span class="toast-icon">
        <Icon name={notification.kind === 'success' ? 'check' : 'info'} size={18} />
      </span>
      <p>{$t(notification.messageKey, notification.parameters)}</p>
      <button
        class="toast-dismiss"
        type="button"
        aria-label={$t('common.close')}
        onclick={() => dismissToast(notification.id)}
      ><Icon name="close" size={16} /></button>
    </article>
  {/each}
</section>
