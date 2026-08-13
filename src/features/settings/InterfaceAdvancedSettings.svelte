<script lang="ts">
  import {
    interfaceModes,
    MAX_IFAC_SIZE_BYTES,
    MIN_IFAC_SIZE_BYTES,
    type IfacConfig,
    type InterfaceMode,
  } from '../../domain/settings';
  import { t, type MessageKey } from '../../i18n';
  import Icon from '../../lib/components/Icon.svelte';

  let {
    mode,
    reannounceOnReconnect,
    ifac,
    onchange,
    onreannouncechange,
    onifacchange,
  }: {
    mode: InterfaceMode;
    reannounceOnReconnect: boolean;
    ifac: IfacConfig;
    onchange: (mode: InterfaceMode) => void;
    onreannouncechange: (enabled: boolean) => void;
    onifacchange: (ifac: IfacConfig) => void;
  } = $props();

  let expanded = $state(false);
  let revealPassphrase = $state(false);

  const labels: Record<InterfaceMode, MessageKey> = {
    full: 'interface.editor.mode.full',
    pointToPoint: 'interface.editor.mode.pointToPoint',
    accessPoint: 'interface.editor.mode.accessPoint',
    roaming: 'interface.editor.mode.roaming',
    boundary: 'interface.editor.mode.boundary',
    gateway: 'interface.editor.mode.gateway',
  };

  const descriptions: Record<InterfaceMode, MessageKey> = {
    full: 'interface.editor.mode.full.help',
    pointToPoint: 'interface.editor.mode.pointToPoint.help',
    accessPoint: 'interface.editor.mode.accessPoint.help',
    roaming: 'interface.editor.mode.roaming.help',
    boundary: 'interface.editor.mode.boundary.help',
    gateway: 'interface.editor.mode.gateway.help',
  };

  function updateIfacSize(event: Event): void {
    if (!(event.currentTarget instanceof HTMLInputElement)) return;
    const next = { ...ifac };
    if (event.currentTarget.value === '') delete next.sizeBytes;
    else next.sizeBytes = event.currentTarget.valueAsNumber;
    onifacchange(next);
  }

</script>

<section class="interface-advanced-settings">
  <button
    class="interface-advanced-toggle"
    class:expanded
    type="button"
    aria-controls="interface-advanced-content"
    aria-expanded={expanded}
    onclick={() => { expanded = !expanded; }}
  >
    {#if expanded}<Icon name="chevron-down" size={17} />{/if}
    <span>{$t(expanded ? 'interface.editor.advanced.hide' : 'interface.editor.advanced.show')}</span>
    {#if !expanded}<Icon name="chevron-down" size={17} />{/if}
  </button>

  {#if expanded}
    <div id="interface-advanced-content" class="interface-advanced-content">
      <div class="interface-advanced-group">
        <label class="toggle-row">
          <span>
            <strong>{$t('interface.editor.reannounceOnReconnect')}</strong>
            <small>{$t('interface.editor.reannounceOnReconnect.help')}</small>
          </span>
          <input
            type="checkbox"
            role="switch"
            checked={reannounceOnReconnect}
            onchange={(event) => onreannouncechange(event.currentTarget.checked)}
          />
        </label>
      </div>
      <div class="interface-advanced-group">
        <label class="field full-width">
          <span>{$t('interface.editor.mode')}</span>
          <select value={mode} onchange={(event) => onchange(event.currentTarget.value as InterfaceMode)}>
            {#each interfaceModes as interfaceMode}
              <option value={interfaceMode}>{$t(labels[interfaceMode])}</option>
            {/each}
          </select>
          <small>{$t(descriptions[mode])}</small>
        </label>
        <p class="interface-mode-notice">{$t('interface.editor.mode.notice')}</p>
      </div>
      <div class="interface-advanced-group interface-ifac-section">
        <div class="interface-ifac-heading">
          <strong>{$t('interface.editor.ifac.title')}</strong>
          <small>{$t('interface.editor.ifac.help')}</small>
        </div>
        <div class="field-grid interface-ifac-grid">
          <label class="field">
            <span>{$t('interface.editor.ifac.networkName')}</span>
            <input
              value={ifac.networkName}
              maxlength="255"
              autocomplete="off"
              autocapitalize="none"
              spellcheck="false"
              oninput={(event) => onifacchange({ ...ifac, networkName: event.currentTarget.value })}
            />
          </label>
          <label class="field interface-ifac-size">
            <span>{$t('interface.editor.ifac.size')}</span>
            <input
              type="number"
              min={MIN_IFAC_SIZE_BYTES}
              max={MAX_IFAC_SIZE_BYTES}
              step="1"
              value={ifac.sizeBytes ?? ''}
              placeholder={$t('interface.editor.ifac.sizeDefault')}
              oninput={updateIfacSize}
            />
          </label>
          <div class="field interface-ifac-passphrase">
            <label for="interface-ifac-passphrase">{$t('interface.editor.ifac.passphrase')}</label>
            <div class="password-input">
              <input
                id="interface-ifac-passphrase"
                type={revealPassphrase ? 'text' : 'password'}
                value={ifac.passphrase}
                maxlength="1024"
                autocomplete="off"
                autocapitalize="none"
                spellcheck="false"
                data-1p-ignore="true"
                data-op-ignore="true"
                data-bwignore="true"
                data-lpignore="true"
                data-form-type="other"
                data-protonpass-ignore="true"
                oninput={(event) => onifacchange({
                  ...ifac,
                  passphrase: event.currentTarget.value,
                  credentialRevision: crypto.randomUUID(),
                })}
              />
              <button
                class="button secondary password-reveal-button"
                type="button"
                aria-label={$t(revealPassphrase ? 'interface.editor.ifac.hidePassphrase' : 'interface.editor.ifac.showPassphrase')}
                title={$t(revealPassphrase ? 'interface.editor.ifac.hidePassphrase' : 'interface.editor.ifac.showPassphrase')}
                onclick={() => { revealPassphrase = !revealPassphrase; }}
              >
                <Icon name={revealPassphrase ? 'eye-off' : 'eye'} size={17} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  {/if}
</section>
