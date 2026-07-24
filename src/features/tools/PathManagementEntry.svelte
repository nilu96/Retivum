<script lang="ts">
  import type { Snippet } from 'svelte';
  import {
    contextMenuTrigger,
    type ContextMenuOpenMethod,
  } from '../../lib/actions/contextMenuTrigger';

  let {
    destinationHash,
    highlighted,
    identityGroupPosition,
    local = false,
    displayName,
    showActions = true,
    onopen,
    badges,
    details,
    actions,
  }: {
    destinationHash: string;
    highlighted: boolean;
    identityGroupPosition?: 'first' | 'middle' | 'last';
    local?: boolean;
    displayName?: string;
    showActions?: boolean;
    onopen: (x: number, y: number, method: ContextMenuOpenMethod) => void;
    badges: Snippet;
    details: Snippet;
    actions?: Snippet;
  } = $props();
</script>

<li
  data-destination-hash={destinationHash}
  class="path-management-context-trigger"
  use:contextMenuTrigger={{ onopen, openOnActivate: true }}
  class:counterpart-highlight={highlighted}
  class:identity-group-entry={identityGroupPosition !== undefined}
  class:identity-group-entry-first={identityGroupPosition === 'first'}
  class:identity-group-entry-last={identityGroupPosition === 'last'}
  class:local-destination-entry={local}
  class:has-entry-name={Boolean(displayName)}
  class:has-actions={actions !== undefined && showActions}
>
  <div
    class="path-management-entry-copy"
    role="button"
    tabindex="0"
    aria-haspopup="menu"
  >
    <header class="path-management-entry-header">
      <div class="path-management-entry-identity">
        {#if displayName}
          <div class="path-management-entry-name">
            <strong>{displayName}</strong>
          </div>
        {/if}
        <code class="path-management-hash">{destinationHash}</code>
      </div>
      <div class="path-management-entry-badges">
        {@render badges()}
      </div>
    </header>
    <div class="path-management-entry-details">
      {@render details()}
    </div>
  </div>
  {#if actions && showActions}
    <div class="path-management-entry-actions" role="group">
      {@render actions()}
    </div>
  {/if}
</li>
