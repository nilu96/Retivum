<script lang="ts">
  import type { MessageKey } from '../../i18n';
  import { t } from '../../i18n';
  import { lockBodyScroll } from '../actions/bodyScrollLock';
  import { copyText } from '../clipboard';
  import { toast } from '../notifications/toasts';
  import Icon from './Icon.svelte';

  let {
    address,
    title,
    description,
    addressLabel,
    copyAddressLabel,
    nameLabel,
    namePlaceholder,
    nameHelp,
    saveErrorKey,
    currentName = '',
    currentOption,
    optionLabel,
    optionNotice,
    options = [],
    oncancel,
    onsave,
  }: {
    address: string;
    title: string;
    description: string;
    addressLabel: string;
    copyAddressLabel: string;
    nameLabel: string;
    namePlaceholder: string;
    nameHelp: string;
    saveErrorKey: MessageKey;
    currentName?: string;
    currentOption?: string;
    optionLabel?: string;
    optionNotice?: string;
    options?: Array<{ value: string; label: string; help: string }>;
    oncancel: () => void;
    onsave: (address: string, name: string, option?: string) => Promise<boolean>;
  } = $props();

  let name = $state('');
  let selectedOption = $state<string>();
  let saving = $state(false);
  const selectedOptionHelp = $derived(
    options.find((option) => option.value === selectedOption)?.help,
  );

  $effect.pre(() => {
    name = currentName;
    selectedOption = currentOption;
  });

  async function copyAddress(): Promise<void> {
    if (await copyText(address)) toast.success('common.copied');
    else toast.error('common.copyFailed');
  }

  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (!name.trim()) return;
    saving = true;
    try {
      if (await onsave(address.trim(), name.trim(), selectedOption)) oncancel();
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
        <button
          class="editor-address-copy"
          type="button"
          title={copyAddressLabel}
          aria-label={copyAddressLabel}
          onclick={copyAddress}
        ><code>{address}</code><Icon name="copy" size={17} /></button>
      </div>
      <label class="field">
        <span>{nameLabel}</span>
        <input
          bind:value={name}
          aria-label={nameLabel}
          maxlength="128"
          placeholder={namePlaceholder}
          autocomplete="off"
          required
        />
        <small>{nameHelp}</small>
      </label>
      {#if optionLabel && options.length}
        <label class="field bookmark-option-field">
          <span>{optionLabel}</span>
          <select bind:value={selectedOption} aria-label={optionLabel}>
            {#each options as option}
              <option value={option.value}>{option.label}</option>
            {/each}
          </select>
          {#if selectedOptionHelp}
            <small>{selectedOptionHelp}</small>
          {/if}
          {#if optionNotice}
            <small class="field-warning">{optionNotice}</small>
          {/if}
        </label>
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
