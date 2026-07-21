<script lang="ts">
  import type { MessageKey } from '../../i18n';
  import { t } from '../../i18n';
  import { lockBodyScroll } from '../actions/bodyScrollLock';
  import { toast } from '../notifications/toasts';
  import Icon from './Icon.svelte';

  let {
    address,
    title,
    description,
    addressLabel,
    nameLabel,
    namePlaceholder,
    nameHelp,
    saveErrorKey,
    currentName = '',
    currentIdentifyBeforeLoad = false,
    identifyLabel,
    identifyHelp,
    oncancel,
    onsave,
  }: {
    address: string;
    title: string;
    description: string;
    addressLabel: string;
    nameLabel: string;
    namePlaceholder: string;
    nameHelp: string;
    saveErrorKey: MessageKey;
    currentName?: string;
    currentIdentifyBeforeLoad?: boolean;
    identifyLabel?: string;
    identifyHelp?: string;
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
      else toast.error(saveErrorKey);
    } catch {
      toast.error(saveErrorKey);
    } finally {
      saving = false;
    }
  }
</script>

<div class="modal-layer" use:lockBodyScroll>
  <button type="button" class="modal-backdrop" aria-label={$t('common.close')} onclick={oncancel}></button>
  <div class="identity-name-editor" role="dialog" aria-modal="true" aria-labelledby="bookmark-editor-title">
    <header>
      <div class="section-icon"><Icon name="bookmark" size={21} /></div>
      <div>
        <h2 id="bookmark-editor-title">{title}</h2>
        <p>{description}</p>
      </div>
    </header>
    <form onsubmit={submit}>
      <div class="bookmark-editor-address">
        <span>{addressLabel}</span>
        <code>{address}</code>
      </div>
      <label class="field">
        <span>{nameLabel}</span>
        <input
          bind:value={name}
          aria-label={nameLabel}
          maxlength="128"
          placeholder={namePlaceholder}
          autocomplete="off"
        />
        <small>{nameHelp}</small>
      </label>
      {#if identifyLabel && identifyHelp}
        <label class="toggle-row bookmark-identify-option">
          <span>
            <strong>{identifyLabel}</strong>
            <small>{identifyHelp}</small>
          </span>
          <input type="checkbox" role="switch" bind:checked={identifyBeforeLoad} />
        </label>
      {/if}
      <footer>
        <button class="button secondary" type="button" onclick={oncancel}>{$t('common.cancel')}</button>
        <button class="button primary" type="submit" disabled={saving}>
          {saving ? $t('common.loading') : $t('common.save')}
        </button>
      </footer>
    </form>
  </div>
</div>
