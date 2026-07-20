<script lang="ts">
  import { createTcpInterfaceDraft, tcpAddress, validateTcpInterface, type InterfaceConfig, type InterfaceValidationCode, type TcpInterfaceConfig } from '../../domain/settings';
  import { t } from '../../i18n';
  import Icon from '../../lib/components/Icon.svelte';
  import ModalDialog from '../../lib/components/ModalDialog.svelte';
  import InterfaceAdvancedSettings from './InterfaceAdvancedSettings.svelte';

  let { config, oncancel, onsave }: {
    config?: TcpInterfaceConfig;
    oncancel: () => void;
    onsave: (config: InterfaceConfig) => Promise<void> | void;
  } = $props();
  let draft = $state(createTcpInterfaceDraft());
  let errors = $state<InterfaceValidationCode[]>([]);
  let saving = $state(false);
  $effect.pre(() => { if (config && draft.id !== config.id) draft = { ...config, connection: { ...config.connection } }; });

  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    errors = validateTcpInterface(draft);
    if (errors.length > 0) return;
    saving = true;
    try {
      draft.name = draft.name.trim();
      draft.connection.host = draft.connection.host.trim();
      await onsave($state.snapshot(draft));
    } finally {
      saving = false;
    }
  }
</script>

<ModalDialog titleId="tcp-editor-title" onclose={oncancel}>
    <header><div class="section-icon"><Icon name="network" size={21} /></div><div><h2 id="tcp-editor-title">{$t(config ? 'interface.editor.tcp.editTitle' : 'interface.editor.tcp.title')}</h2><p>{$t('interface.editor.tcp.notice')}</p></div></header>
    <form onsubmit={submit}>
      {#if errors.length > 0}<div class="validation-summary" role="alert">{#each errors as error}<p>{$t(error)}</p>{/each}</div>{/if}
      <label class="field full-width"><span>{$t('interface.editor.name')}</span><input bind:value={draft.name} placeholder={$t('interface.editor.name.placeholder')} autocomplete="off" /></label>
      <div class="field-grid tcp-endpoint-grid">
        <label class="field host-field"><span>{$t('interface.editor.host')}</span><input bind:value={draft.connection.host} autocapitalize="none" spellcheck="false" /></label>
        <label class="field port-field"><span>{$t('interface.editor.port')}</span><input type="number" min="1" max="65535" bind:value={draft.connection.port} /></label>
      </div>
      <div class="endpoint-preview">{tcpAddress(draft)}</div>
      <div class="interface-editor-final-settings">
        <label class="toggle-row"><span><strong>{$t('interface.editor.enabled')}</strong></span><input type="checkbox" role="switch" bind:checked={draft.enabled} /></label>
        <InterfaceAdvancedSettings mode={draft.mode} onchange={(mode) => { draft.mode = mode; }} />
      </div>
      <footer><button class="button secondary" type="button" onclick={oncancel}>{$t('common.cancel')}</button><button class="button primary" type="submit" disabled={saving}>{saving ? $t('common.loading') : $t('common.save')}</button></footer>
    </form>
</ModalDialog>
