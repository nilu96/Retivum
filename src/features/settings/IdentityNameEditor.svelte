<script lang="ts">
  import { t } from '../../i18n';
  import { lockBodyScroll } from '../../lib/actions/bodyScrollLock';
  import Icon from '../../lib/components/Icon.svelte';
  import { toast } from '../../lib/notifications/toasts';

  let {
    currentName,
    mode = 'edit',
    oncancel,
    onsave,
  }: {
    currentName: string;
    mode?: 'add' | 'edit' | 'import';
    oncancel: () => void;
    onsave: (displayName: string) => Promise<boolean>;
  } = $props();

  let displayName = $state('');
  let saving = $state(false);

  $effect.pre(() => {
    displayName = currentName;
  });

  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    const normalized = displayName.trim();
    if (!normalized) return;
    saving = true;
    try {
      if (await onsave(normalized)) oncancel();
      else toast.error(mode === 'import' ? 'settings.identity.importError' : 'settings.identity.displayName.saveError');
    } catch {
      toast.error(mode === 'import' ? 'settings.identity.importError' : 'settings.identity.displayName.saveError');
    } finally {
      saving = false;
    }
  }
</script>

<div class="modal-layer" use:lockBodyScroll>
  <button type="button" class="modal-backdrop" aria-label={$t('common.close')} onclick={oncancel}></button>
  <div class="identity-name-editor" role="dialog" aria-modal="true" aria-labelledby="identity-name-editor-title">
    <header>
      <div class="section-icon identity"><Icon name="identity" size={21} /></div>
      <div>
        <h2 id="identity-name-editor-title">{$t(mode === 'add'
          ? 'settings.identity.editor.addTitle'
          : mode === 'import'
            ? 'settings.identity.editor.importTitle'
            : 'settings.identity.editor.title')}</h2>
        <p>{$t(mode === 'add'
          ? 'settings.identity.editor.addDescription'
          : mode === 'import'
            ? 'settings.identity.editor.importDescription'
            : 'settings.identity.editor.description')}</p>
      </div>
    </header>
    <form onsubmit={submit}>
      <label class="field">
        <span>{$t('settings.identity.displayName')}</span>
        <input bind:value={displayName} maxlength="128" autocomplete="nickname" />
        <small>{$t('settings.identity.displayName.help')}</small>
      </label>
      <footer>
        <button class="button secondary" type="button" onclick={oncancel}>{$t('common.cancel')}</button>
        <button class="button primary" type="submit" disabled={saving || !displayName.trim()}>
          {saving ? $t('common.loading') : $t(mode === 'import' ? 'settings.identity.import' : 'common.save')}
        </button>
      </footer>
    </form>
  </div>
</div>
