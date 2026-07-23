<script lang="ts">
  import type { Snippet } from 'svelte';
  import { t } from '../../i18n';
  import {
    contextMenuTrigger,
    type ContextMenuOpenMethod,
  } from '../../lib/actions/contextMenuTrigger';

  let {
    destinationHash,
    counterpartAvailable,
    highlighted,
    hoverSuppressed,
    identityGroupPosition,
    local = false,
    localContactName,
    announcedName,
    showActions = true,
    onopen,
    onactivate,
    badges,
    details,
    actions,
  }: {
    destinationHash: string;
    counterpartAvailable: boolean;
    highlighted: boolean;
    hoverSuppressed: boolean;
    identityGroupPosition?: 'first' | 'middle' | 'last';
    local?: boolean;
    localContactName?: string;
    announcedName?: string;
    showActions?: boolean;
    onopen: (x: number, y: number, method: ContextMenuOpenMethod) => void;
    onactivate: () => void;
    badges: Snippet;
    details: Snippet;
    actions?: Snippet;
  } = $props();
  let actionsHovered = $state(false);

  function activateFromKeyboard(event: KeyboardEvent): void {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    if (counterpartAvailable) onactivate();
  }
</script>

<li
  data-destination-hash={destinationHash}
  use:contextMenuTrigger={{ onopen }}
  class:counterpart-available={counterpartAvailable}
  class:counterpart-highlight={highlighted}
  class:counterpart-hover-suppressed={hoverSuppressed}
  class:identity-group-entry={identityGroupPosition !== undefined}
  class:identity-group-entry-first={identityGroupPosition === 'first'}
  class:identity-group-entry-last={identityGroupPosition === 'last'}
  class:local-destination-entry={local}
  class:has-entry-name={Boolean(localContactName || announcedName)}
  class:has-actions={actions !== undefined && showActions}
  class:entry-actions-hovered={actionsHovered}
>
  <div
    class="path-management-entry-copy"
    role="button"
    tabindex="0"
    aria-disabled={!counterpartAvailable}
    onclick={() => { if (counterpartAvailable) onactivate(); }}
    onkeydown={activateFromKeyboard}
  >
    <header class="path-management-entry-header">
      <div class="path-management-entry-identity">
        {#if localContactName}
          <div class="path-management-entry-name">
            <strong>{localContactName}</strong>
            <span class="known-destination-local-badge">
              {$t('pathManagement.destination.localContact')}
            </span>
          </div>
          {#if announcedName}
            <small>{$t('pathManagement.destination.announcedAs', { name: announcedName })}</small>
          {/if}
        {:else if announcedName}
          <div class="path-management-entry-name">
            <strong>{announcedName}</strong>
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
    <div
      class="path-management-entry-actions"
      role="group"
      onpointerenter={() => { actionsHovered = true; }}
      onpointerleave={() => { actionsHovered = false; }}
    >
      {@render actions()}
    </div>
  {/if}
</li>
