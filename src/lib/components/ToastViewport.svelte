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
      class:info={notification.kind === 'info'}
      class:error={notification.kind === 'error'}
      class:activity={notification.kind === 'activity'}
      role={notification.kind === 'error' ? 'alert' : 'status'}
      aria-busy={notification.kind === 'activity'}
    >
      <span class="toast-icon">
        <Icon name={notification.kind === 'success' ? 'check' : notification.kind === 'activity' ? 'sync' : 'info'} size={18} />
      </span>
      <p>{$t(notification.messageKey, notification.parameters)}</p>
      {#if notification.kind !== 'activity'}
        <button
          class="toast-dismiss"
          type="button"
          aria-label={$t('common.close')}
          onclick={() => dismissToast(notification.id)}
        ><Icon name="close" size={16} /></button>
      {:else if notification.oncancel}
        <button
          class="toast-dismiss"
          type="button"
          aria-label={$t('toast.activity.cancel')}
          onclick={() => {
            dismissToast(notification.id);
            notification.oncancel?.();
          }}
        ><Icon name="close" size={16} /></button>
      {:else}
        <span class="toast-activity-space" aria-hidden="true"></span>
      {/if}
    </article>
  {/each}
</section>
