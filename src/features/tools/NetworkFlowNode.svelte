<script lang="ts">
  import { Handle, type NodeProps } from '@xyflow/svelte';
  import { contextMenuTrigger } from '../../lib/actions/contextMenuTrigger';
  import Icon from '../../lib/components/Icon.svelte';
  import {
    networkFlowHandlePositions,
    type RetivumFlowNode,
  } from './network-flow';

  let { data }: NodeProps<RetivumFlowNode> = $props();

  const labelStyle = $derived([
    `--network-label-x:${data.labelPlacement.x}px`,
    `--network-label-y:${data.labelPlacement.y}px`,
    `--network-label-shift:${data.labelPlacement.anchor === 'middle' ? '-50%' : data.labelPlacement.anchor === 'end' ? '-100%' : '0%'}`,
  ].join(';'));
  const iconSize = $derived(data.kind === 'local' ? 34 : data.kind === 'interface' ? 28 : 24);
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex (actionable nodes receive a dynamic button role) -->
<div
  class="network-flow-node"
  class:online={data.interfaceState === 'online'}
  class:search-match={data.searchActive && data.matched}
  class:search-dimmed={data.searchActive && !data.matched}
  class:destination={data.kind === 'destination'}
  class:interface={data.kind === 'interface'}
  class:local={data.kind === 'local'}
  class:next-hop={data.kind === 'nextHop'}
  data-state={data.interfaceState}
  use:contextMenuTrigger={{
    onopen: data.onopen,
    openOnActivate: true,
    disabled: !data.actionable,
  }}
  role={data.actionable ? 'button' : undefined}
  tabindex={data.actionable ? 0 : undefined}
  aria-label={data.ariaLabel}
  aria-haspopup={data.actionable ? 'menu' : undefined}
  title={data.ariaLabel}
>
  {#each networkFlowHandlePositions as handle}
    <Handle
      id={`target-${handle.name}`}
      type="target"
      position={handle.position}
      isConnectable={false}
      class="network-flow-handle"
      aria-hidden="true"
    />
    <Handle
      id={`source-${handle.name}`}
      type="source"
      position={handle.position}
      isConnectable={false}
      class="network-flow-handle"
      aria-hidden="true"
    />
  {/each}
  <span class="network-flow-badge" aria-hidden="true">
    <span class="network-flow-symbol"><Icon name={data.icon} size={iconSize} /></span>
  </span>
  <span class="network-flow-label" style={labelStyle}>{data.label}</span>
</div>

<style>
  .network-flow-node { --network-node-color: var(--text-subtle); --network-node-ink: var(--surface-1); position: relative; width: 100%; height: 100%; outline: none; transition: opacity .18s ease; }
  .network-flow-node.search-dimmed { opacity: 1; }
  .network-flow-node.local { --network-node-color: #4385e7; --network-node-ink: #fff; }
  .network-flow-node.interface { --network-node-color: var(--accent); --network-node-ink: var(--accent-ink); }
  .network-flow-node.interface[data-state='connecting'], .network-flow-node.interface[data-state='reconnecting'] { --network-node-color: var(--warning); --network-node-ink: var(--surface-1); }
  .network-flow-node.interface[data-state='offline'], .network-flow-node.interface[data-state='disabled'] { --network-node-color: var(--text-subtle); --network-node-ink: var(--surface-1); }
  .network-flow-node.interface[data-state='error'] { --network-node-color: var(--danger); --network-node-ink: var(--danger-ink); }
  .network-flow-node.next-hop { --network-node-color: var(--warning); --network-node-ink: var(--surface-1); }
  .network-flow-node.destination { --network-node-color: #8872d8; --network-node-ink: #fff; }
  .network-flow-badge { position: absolute; display: grid; inset: 0; place-items: center; border: 3px solid color-mix(in srgb, var(--network-node-color) 76%, var(--surface-1)); border-radius: 50%; color: var(--network-node-ink); background: var(--network-node-color); box-shadow: 0 2px 8px color-mix(in srgb, var(--network-node-color) 18%, transparent), inset 0 0 0 1px color-mix(in srgb, #fff 20%, transparent); transition: border-color .18s ease, background .18s ease, box-shadow .18s ease, scale .18s ease; }
  .network-flow-node.search-dimmed .network-flow-badge { border-color: color-mix(in srgb, var(--network-node-color) 16%, var(--surface-1)); color: color-mix(in srgb, var(--network-node-ink) 16%, var(--surface-1)); background: color-mix(in srgb, var(--network-node-color) 16%, var(--surface-1)); box-shadow: none; }
  .network-flow-node.local .network-flow-badge { border-width: 4px; box-shadow: 0 0 0 3px color-mix(in srgb, var(--network-node-color) 22%, transparent), 0 3px 10px color-mix(in srgb, var(--network-node-color) 22%, transparent), inset 0 0 0 1px color-mix(in srgb, #fff 26%, transparent); }
  .network-flow-symbol { display: grid; place-items: center; }
  .network-flow-node.search-match .network-flow-badge { border-color: var(--warning); box-shadow: 0 0 0 5px color-mix(in srgb, var(--warning) 24%, transparent), 0 3px 10px color-mix(in srgb, var(--warning) 25%, transparent); scale: 1.06; }
  .network-flow-label { position: absolute; z-index: 2; width: max-content; max-width: 150px; left: calc(50% + var(--network-label-x)); top: calc(50% + var(--network-label-y)); color: var(--text); font-size: 12px; font-weight: 680; line-height: 1.15; text-shadow: 0 0 5px var(--surface-1), 0 0 5px var(--surface-1), 0 0 5px var(--surface-1); translate: var(--network-label-shift) -50%; transition: color .18s ease; white-space: nowrap; pointer-events: none; }
  .network-flow-node.search-dimmed .network-flow-label { color: color-mix(in srgb, var(--text) 16%, var(--surface-1)); }
  .network-flow-node.local .network-flow-label { font-size: 13px; font-weight: 730; }
  .network-flow-node.search-match .network-flow-label { color: var(--warning); }
  .network-flow-node:focus-visible .network-flow-badge { box-shadow: 0 0 0 5px var(--accent-soft), 0 0 0 2px var(--accent); }
  :global(.network-flow-handle) { width: 1px !important; min-width: 1px !important; height: 1px !important; min-height: 1px !important; top: 50% !important; right: auto !important; bottom: auto !important; left: 50% !important; border: 0 !important; background: transparent !important; opacity: 0 !important; transform: translate(-50%, -50%) !important; pointer-events: none !important; }
</style>
