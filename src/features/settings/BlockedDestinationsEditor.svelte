<script lang="ts">
  import { normalizeDestinationHash } from '../../domain/settings';
  import { t } from '../../i18n';
  import { lockBodyScroll } from '../../lib/actions/bodyScrollLock';
  import Icon from '../../lib/components/Icon.svelte';
  import { toast } from '../../lib/notifications/toasts';

  const maxDestinationCount = 256;

  let {
    oncancel,
    onsave,
  }: {
    oncancel: () => void;
    onsave: (destinationHashes: string[]) => Promise<boolean>;
  } = $props();

  let value = $state('');
  let saving = $state(false);
  let interacted = $state(false);
  const parsed = $derived.by(() => {
    const lines = value
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    const normalized = lines.map(normalizeDestinationHash);
    return {
      empty: lines.length === 0,
      invalid: normalized.some((destinationHash) => destinationHash === undefined),
      tooMany: lines.length > maxDestinationCount,
      destinationHashes: Array.from(new Set(
        normalized.filter((destinationHash): destinationHash is string => destinationHash !== undefined),
      )),
    };
  });
  const validationKey = $derived(
    parsed.empty
      ? 'settings.blocked.editor.required'
      : parsed.tooMany
        ? 'settings.blocked.editor.tooMany'
        : parsed.invalid
          ? 'settings.blocked.editor.invalid'
          : undefined,
  );
  const visibleValidationKey = $derived(interacted ? validationKey : undefined);

  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (validationKey || saving) return;
    saving = true;
    try {
      if (await onsave(parsed.destinationHashes)) oncancel();
      else toast.error('settings.blocked.editor.saveError');
    } catch {
      toast.error('settings.blocked.editor.saveError');
    } finally {
      saving = false;
    }
  }
</script>

<div class="modal-layer" use:lockBodyScroll>
  <button type="button" class="modal-backdrop" aria-label={$t('common.close')} onclick={oncancel}></button>
  <div class="identity-name-editor" role="dialog" aria-modal="true" aria-labelledby="blocked-destinations-editor-title">
    <header>
      <div class="section-icon danger"><Icon name="block" size={21} /></div>
      <div>
        <h2 id="blocked-destinations-editor-title">{$t('settings.blocked.editor.title')}</h2>
        <p>{$t('settings.blocked.editor.description')}</p>
      </div>
    </header>
    <form onsubmit={submit}>
      <label class="field">
        <span>{$t('settings.blocked.editor.destinations')}</span>
        <textarea
          class="blocked-destinations-editor-input"
          bind:value
          oninput={() => { interacted = true; }}
          rows="6"
          maxlength="10000"
          placeholder={$t('settings.blocked.editor.placeholder')}
          aria-invalid={visibleValidationKey !== undefined}
          autocomplete="off"
          autocapitalize="none"
          spellcheck="false"
        ></textarea>
        <small>{$t('settings.blocked.editor.help', { count: maxDestinationCount })}</small>
      </label>
      {#if visibleValidationKey}
        <div class="validation-summary" role="alert"><p>{$t(visibleValidationKey, { count: maxDestinationCount })}</p></div>
      {/if}
      <footer>
        <button class="button secondary" type="button" onclick={oncancel}>{$t('common.cancel')}</button>
        <button class="button primary" type="submit" disabled={saving || validationKey !== undefined}>
          {saving ? $t('common.loading') : $t('settings.blocked.editor.submit')}
        </button>
      </footer>
    </form>
  </div>
</div>
