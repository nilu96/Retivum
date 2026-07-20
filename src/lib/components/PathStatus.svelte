<script lang="ts">
  import type { DestinationPathStatus } from '../../infrastructure/reticulum/protocol';
  import { t } from '../../i18n';
  import Icon from './Icon.svelte';

  let { status, blocked = false }: { status?: DestinationPathStatus; blocked?: boolean } = $props();
  const known = $derived(status?.hasPath === true && status.hops !== undefined);
  const label = $derived(blocked
    ? $t('path.blocked')
    : known
    ? $t(status?.hops === 1 ? 'path.known.one' : 'path.known.other', { count: status?.hops ?? 0 })
    : $t('path.unknown'));
</script>

<span class="path-status" class:known={known && !blocked} class:blocked aria-label={label} title={label}>
  <Icon name={blocked ? 'block' : known ? 'route' : 'route-off'} size={15} />
  {#if known && !blocked}<span>{status?.hops}</span>{/if}
</span>

<style>
  .path-status {
    display: inline-flex;
    min-width: 25px;
    align-items: center;
    justify-content: center;
    gap: 2px;
    color: var(--text-subtle);
    font-size: .67rem;
    font-variant-numeric: tabular-nums;
    line-height: 1;
  }

  .path-status.known { color: var(--accent); }
  .path-status.blocked { color: var(--danger); }
</style>
