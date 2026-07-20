<script lang="ts">
  import {
    createUdpInterfaceDraft,
    udpAddress,
    validateUdpInterface,
    type InterfaceConfig,
    type InterfaceValidationCode,
    type UdpInterfaceConfig,
  } from '../../domain/settings';
  import { t } from '../../i18n';
  import Icon from '../../lib/components/Icon.svelte';
  import ModalDialog from '../../lib/components/ModalDialog.svelte';
  import InterfaceAdvancedSettings from './InterfaceAdvancedSettings.svelte';

  let { config, oncancel, onsave }: {
    config?: UdpInterfaceConfig;
    oncancel: () => void;
    onsave: (config: InterfaceConfig) => Promise<void> | void;
  } = $props();

  let draft = $state(createUdpInterfaceDraft());
  let errors = $state<InterfaceValidationCode[]>([]);
  let saving = $state(false);

  $effect.pre(() => {
    if (config && draft.id !== config.id) draft = { ...config, connection: { ...config.connection } };
  });

  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    errors = validateUdpInterface(draft);
    if (errors.length > 0) return;
    saving = true;
    try {
      draft.name = draft.name.trim();
      draft.connection.listenHost = draft.connection.listenHost.trim();
      draft.connection.forwardHost = draft.connection.forwardHost.trim();
      await onsave($state.snapshot(draft));
    } finally {
      saving = false;
    }
  }
</script>

<ModalDialog titleId="udp-editor-title" onclose={oncancel}>
    <header>
      <div class="section-icon"><Icon name="network" size={21} /></div>
      <div>
        <h2 id="udp-editor-title">{$t(config ? 'interface.editor.udp.editTitle' : 'interface.editor.udp.title')}</h2>
        <p>{$t('interface.editor.udp.notice')}</p>
      </div>
    </header>
    <form onsubmit={submit}>
      {#if errors.length > 0}
        <div class="validation-summary" role="alert">
          {#each errors as error}<p>{$t(error)}</p>{/each}
        </div>
      {/if}
      <label class="field full-width">
        <span>{$t('interface.editor.name')}</span>
        <input bind:value={draft.name} placeholder={$t('interface.editor.name.placeholder')} autocomplete="off" />
      </label>
      <div class="udp-endpoint-section">
        <div class="field-grid udp-endpoint-grid">
          <label class="field host-field">
            <span>{$t('interface.editor.udp.listenHost')}</span>
            <input bind:value={draft.connection.listenHost} autocapitalize="none" spellcheck="false" />
          </label>
          <label class="field port-field">
            <span>{$t('interface.editor.udp.listenPort')}</span>
            <input type="number" min="1" max="65535" bind:value={draft.connection.listenPort} inputmode="numeric" />
          </label>
        </div>
        <small>{$t('interface.editor.udp.listenHelp')}</small>
      </div>
      <div class="udp-endpoint-section">
        <div class="field-grid udp-endpoint-grid">
          <label class="field host-field">
            <span>{$t('interface.editor.udp.forwardHost')}</span>
            <input bind:value={draft.connection.forwardHost} autocapitalize="none" spellcheck="false" />
          </label>
          <label class="field port-field">
            <span>{$t('interface.editor.udp.forwardPort')}</span>
            <input type="number" min="1" max="65535" bind:value={draft.connection.forwardPort} inputmode="numeric" />
          </label>
        </div>
        <small>{$t('interface.editor.udp.forwardHelp')}</small>
      </div>
      <div class="endpoint-preview">{udpAddress(draft)}</div>
      <div class="interface-editor-final-settings">
        <label class="toggle-row">
          <span><strong>{$t('interface.editor.enabled')}</strong></span>
          <input type="checkbox" role="switch" bind:checked={draft.enabled} />
        </label>
        <InterfaceAdvancedSettings
          mode={draft.mode}
          reannounceOnReconnect={draft.reannounceOnReconnect}
          onchange={(mode) => { draft.mode = mode; }}
          onreannouncechange={(enabled) => { draft.reannounceOnReconnect = enabled; }}
        />
      </div>
      <footer>
        <button class="button secondary" type="button" onclick={oncancel}>{$t('common.cancel')}</button>
        <button class="button primary" type="submit" disabled={saving}>{saving ? $t('common.loading') : $t('common.save')}</button>
      </footer>
    </form>
</ModalDialog>
