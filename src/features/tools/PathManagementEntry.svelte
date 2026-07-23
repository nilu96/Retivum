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
  const pointerMoveThreshold = 5;
  let actionsHovered = $state(false);
  let entryCopy: HTMLDivElement;
  let pointerOrigin: { id: number; x: number; y: number } | undefined;
  let pointerMoved = $state(false);
  let textSelectionActive = $state(false);
  let suppressNextPointerActivation = false;

  function entryContainsSelection(): boolean {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.toString().length === 0) return false;
    return Boolean(
      (selection.anchorNode && entryCopy.contains(selection.anchorNode))
      || (selection.focusNode && entryCopy.contains(selection.focusNode)),
    );
  }

  function handlePointerDown(event: PointerEvent): void {
    if (event.button !== 0 || !counterpartAvailable) return;
    pointerOrigin = { id: event.pointerId, x: event.clientX, y: event.clientY };
    pointerMoved = false;
    textSelectionActive = false;
    suppressNextPointerActivation = false;
  }

  function handlePointerMove(event: PointerEvent): void {
    if (!pointerOrigin) {
      textSelectionActive = entryContainsSelection();
      return;
    }
    if (event.pointerId !== pointerOrigin.id || pointerMoved) return;
    if (
      Math.abs(event.clientX - pointerOrigin.x) >= pointerMoveThreshold
      || Math.abs(event.clientY - pointerOrigin.y) >= pointerMoveThreshold
    ) {
      pointerMoved = true;
    }
  }

  function handlePointerUp(event: PointerEvent): void {
    if (!pointerOrigin || event.pointerId !== pointerOrigin.id) return;
    suppressNextPointerActivation = pointerMoved;
    pointerOrigin = undefined;
  }

  function handlePointerCancel(event: PointerEvent): void {
    if (!pointerOrigin || event.pointerId !== pointerOrigin.id) return;
    pointerOrigin = undefined;
    pointerMoved = false;
    textSelectionActive = entryContainsSelection();
    suppressNextPointerActivation = false;
  }

  function resetFinishedPointerInteraction(event: PointerEvent): void {
    if (event.buttons !== 0) return;
    pointerOrigin = undefined;
    pointerMoved = false;
    textSelectionActive = entryContainsSelection();
    suppressNextPointerActivation = false;
  }

  function activateFromPointer(): void {
    textSelectionActive = entryContainsSelection();
    const activationSuppressed = suppressNextPointerActivation || textSelectionActive;
    suppressNextPointerActivation = false;
    pointerMoved = false;
    if (!activationSuppressed && counterpartAvailable) onactivate();
  }

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
  class:entry-pointer-moved={pointerMoved}
  class:entry-text-selected={textSelectionActive}
>
  <div
    bind:this={entryCopy}
    class="path-management-entry-copy"
    role="button"
    tabindex="0"
    aria-disabled={!counterpartAvailable}
    onclick={activateFromPointer}
    onkeydown={activateFromKeyboard}
    onpointerdown={handlePointerDown}
    onpointermove={handlePointerMove}
    onpointerup={handlePointerUp}
    onpointercancel={handlePointerCancel}
    onpointerenter={resetFinishedPointerInteraction}
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
