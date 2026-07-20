<script lang="ts">
  import { t } from '../../i18n';
  import { lockBodyScroll } from '../../lib/actions/bodyScrollLock';
  import Icon from '../../lib/components/Icon.svelte';
  import { toast } from '../../lib/notifications/toasts';

  let {
    address,
    currentName = '',
    currentIdentifyBeforeLoad = false,
    mode = 'add',
    oncancel,
    onsave,
  }: {
    address: string;
    currentName?: string;
    currentIdentifyBeforeLoad?: boolean;
    mode?: 'add' | 'edit';
    oncancel: () => void;
    onsave: (name: string, identifyBeforeLoad: boolean) => Promise<boolean>;
  } = $props();

  let name = $state('');
  let identifyBeforeLoad = $state(false);
  let saving = $state(false);

  $effect.pre(() => {
    name = currentName;
    identifyBeforeLoad = currentIdentifyBeforeLoad;
  });

  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    saving = true;
    try {
      if (await onsave(name.trim(), identifyBeforeLoad)) oncancel();
      else toast.error('nomadnet.bookmark.saveError');
    } catch {
      toast.error('nomadnet.bookmark.saveError');
    } finally {
      saving = false;
    }
  }
</script>

<div class="modal-layer" use:lockBodyScroll>
  <button type="button" class="modal-backdrop" aria-label={$t('common.close')} onclick={oncancel}></button>
  <div class="identity-name-editor" role="dialog" aria-modal="true" aria-labelledby="nomad-bookmark-editor-title">
    <header>
      <div class="section-icon"><Icon name="bookmark" size={21} /></div>
      <div>
        <h2 id="nomad-bookmark-editor-title">{$t(mode === 'add' ? 'nomadnet.bookmark.editor.addTitle' : 'nomadnet.bookmark.editor.editTitle')}</h2>
        <p>{$t('nomadnet.bookmark.editor.description')}</p>
      </div>
    </header>
    <form onsubmit={submit}>
      <div class="bookmark-editor-address">
        <span>{$t('nomadnet.bookmark.address')}</span>
        <code>{address}</code>
      </div>
      <label class="field">
        <span>{$t('nomadnet.bookmark.name')}</span>
        <input
          bind:value={name}
          aria-label={$t('nomadnet.bookmark.name')}
          maxlength="128"
          placeholder={$t('nomadnet.bookmark.name.placeholder')}
          autocomplete="off"
        />
        <small>{$t('nomadnet.bookmark.name.help')}</small>
      </label>
      <label class="toggle-row bookmark-identify-option">
        <span>
          <strong>{$t('nomadnet.bookmark.identifyBeforeLoad')}</strong>
          <small>{$t('nomadnet.bookmark.identifyBeforeLoad.help')}</small>
        </span>
        <input type="checkbox" role="switch" bind:checked={identifyBeforeLoad} />
      </label>
      <footer>
        <button class="button secondary" type="button" onclick={oncancel}>{$t('common.cancel')}</button>
        <button class="button primary" type="submit" disabled={saving}>
          {saving ? $t('common.loading') : $t('common.save')}
        </button>
      </footer>
    </form>
  </div>
</div>
