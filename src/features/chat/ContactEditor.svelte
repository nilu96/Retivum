<script lang="ts">
  import { t } from '../../i18n';
  import { lockBodyScroll } from '../../lib/actions/bodyScrollLock';
  import Icon from '../../lib/components/Icon.svelte';
  import { toast } from '../../lib/notifications/toasts';

  let {
    address,
    currentName = '',
    mode = 'add',
    oncancel,
    onsave,
  }: {
    address: string;
    currentName?: string;
    mode?: 'add' | 'edit';
    oncancel: () => void;
    onsave: (name: string) => Promise<boolean>;
  } = $props();

  let name = $state('');
  let saving = $state(false);

  $effect.pre(() => { name = currentName; });

  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (!name.trim()) return;
    saving = true;
    try {
      if (await onsave(name.trim())) oncancel();
      else toast.error('chat.contact.saveError');
    } catch {
      toast.error('chat.contact.saveError');
    } finally {
      saving = false;
    }
  }
</script>

<div class="modal-layer" use:lockBodyScroll>
  <button type="button" class="modal-backdrop" aria-label={$t('common.close')} onclick={oncancel}></button>
  <div class="identity-name-editor" role="dialog" aria-modal="true" aria-labelledby="contact-editor-title">
    <header>
      <div class="section-icon identity"><Icon name="identity" size={21} /></div>
      <div>
        <h2 id="contact-editor-title">{$t(mode === 'add' ? 'chat.contact.addTitle' : 'chat.contact.editTitle')}</h2>
        <p>{$t('chat.contact.description')}</p>
      </div>
    </header>
    <form onsubmit={submit}>
      <div class="bookmark-editor-address">
        <span>{$t('chat.contact.destination')}</span>
        <code>{address}</code>
      </div>
      <label class="field">
        <span>{$t('chat.contact.name')}</span>
        <input bind:value={name} maxlength="128" autocomplete="nickname" />
        <small>{$t('chat.contact.name.help')}</small>
      </label>
      {#if !name.trim()}
        <div class="validation-summary" role="alert"><p>{$t('chat.contact.name.required')}</p></div>
      {/if}
      <footer>
        <button class="button secondary" type="button" onclick={oncancel}>{$t('common.cancel')}</button>
        <button class="button primary" type="submit" disabled={saving || !name.trim()}>
          {saving ? $t('common.loading') : $t('common.save')}
        </button>
      </footer>
    </form>
  </div>
</div>
