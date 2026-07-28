<script lang="ts">
  import { t } from '../../i18n';
  import { copyText } from '../../lib/clipboard';
  import Icon from '../../lib/components/Icon.svelte';
  import { toast } from '../../lib/notifications/toasts';

  let { address }: { address: string } = $props();

  async function copyAddress(): Promise<void> {
    if (await copyText(address)) toast.success('common.copied');
    else toast.error('common.copyFailed');
  }
</script>

<button
  class="endpoint-preview"
  type="button"
  title={$t('interface.editor.endpoint.copy')}
  aria-label={$t('interface.editor.endpoint.copy')}
  onclick={copyAddress}
>
  <code>{address}</code>
  <Icon name="copy" size={16} />
</button>
