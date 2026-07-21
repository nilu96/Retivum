<script lang="ts">
  import { t } from '../../i18n';
  import ConfirmationDialog from '../../lib/components/ConfirmationDialog.svelte';

  let {
    identityName,
    oncancel,
    onconfirm,
  }: {
    identityName: string;
    oncancel: () => void;
    onconfirm: () => Promise<void>;
  } = $props();
</script>

<ConfirmationDialog
  titleId="identity-delete-title"
  title={$t('settings.identity.deleteDialog.title')}
  description={$t('settings.identity.deleteConfirm', { name: identityName })}
  icon="identity"
  confirmLabel={$t('settings.identity.delete')}
  tone="danger"
  {oncancel}
  {onconfirm}
/>
