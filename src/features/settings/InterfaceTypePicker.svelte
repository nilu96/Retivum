<script lang="ts">
  import { onMount } from 'svelte';
  import type { InterfaceType } from '../../domain/settings';
  import { t } from '../../i18n';
  import Icon from '../../lib/components/Icon.svelte';
  import { interfaceTypeDescriptors } from './interface-types';

  let { onselect, types = ['websocket'] }: { onselect: (type: InterfaceType) => void; types?: InterfaceType[] } = $props();
  let open = $state(false);
  let root = $state<HTMLDivElement>();

  function select(type: InterfaceType): void {
    open = false;
    onselect(type);
  }

  onMount(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (open && root && !root.contains(event.target as Node)) open = false;
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') open = false;
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  });
</script>

<div class="interface-type-picker" bind:this={root}>
  <button
    class="button primary compact interface-add-button"
    type="button"
    aria-haspopup="menu"
    aria-expanded={open}
    onclick={() => { open = !open; }}
  >
    <Icon name="plus" size={17} />
    <span>{$t('settings.interfaces.add')}</span>
    <Icon name="chevron-down" size={16} />
  </button>

  {#if open}
    <div class="interface-type-menu" role="menu" aria-label={$t('settings.interfaces.typeMenu')}>
      {#each interfaceTypeDescriptors.filter((descriptor) => types.includes(descriptor.type)) as descriptor (descriptor.type)}
        <button type="button" role="menuitem" onclick={() => select(descriptor.type)}>
          <span class="interface-type-icon"><Icon name={descriptor.icon} size={19} /></span>
          <span>
            <strong>{$t(descriptor.title)}</strong>
            <small>{$t(descriptor.description)}</small>
          </span>
        </button>
      {/each}
    </div>
  {/if}
</div>
