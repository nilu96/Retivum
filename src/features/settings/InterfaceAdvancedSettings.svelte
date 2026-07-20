<script lang="ts">
  import { interfaceModes, type InterfaceMode } from '../../domain/settings';
  import { t, type MessageKey } from '../../i18n';
  import Icon from '../../lib/components/Icon.svelte';

  let {
    mode,
    reannounceOnReconnect,
    onchange,
    onreannouncechange,
  }: {
    mode: InterfaceMode;
    reannounceOnReconnect: boolean;
    onchange: (mode: InterfaceMode) => void;
    onreannouncechange: (enabled: boolean) => void;
  } = $props();

  let expanded = $state(false);

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
    </div>
  {/if}
</section>
