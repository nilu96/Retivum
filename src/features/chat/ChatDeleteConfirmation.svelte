<script lang="ts">
  import { t } from '../../i18n';
  import ConfirmationDialog from '../../lib/components/ConfirmationDialog.svelte';

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

  const titleId = $derived(`chat-${kind}-delete-title`);
</script>

<ConfirmationDialog
  {titleId}
  title={$t(kind === 'conversation'
    ? 'chat.conversation.deleteDialog.title'
    : 'chat.message.deleteDialog.title')}
  description={$t(kind === 'conversation'
    ? 'chat.conversation.deleteDialog.description'
    : 'chat.message.deleteDialog.description', { name: chatName })}
  icon={kind === 'conversation' ? 'chat' : 'trash'}
  confirmLabel={$t(kind === 'conversation'
    ? 'chat.conversation.deleteDialog.confirm'
    : 'chat.message.actions.delete')}
  tone="danger"
  {oncancel}
  {onconfirm}
/>
