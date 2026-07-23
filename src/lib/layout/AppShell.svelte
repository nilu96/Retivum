<script lang="ts">
  import { onDestroy, tick, type Snippet } from 'svelte';
  import type { AppRoute } from '../../app/router';
  import { navigateToSettingsSection, navigateTopLevel } from '../../app/router';
  import { t, type MessageKey } from '../../i18n';
  import Icon, { type IconName } from '../components/Icon.svelte';
  import { createLxmaAddress } from '../../domain/lxmf';
  import {
    activeIdentity,
    deliveryDestinationHash,
    reticulumRuntime,
    runtimeStatus,
  } from '../../infrastructure/reticulum/runtime';
  import { unreadChatMessageCount } from '../../infrastructure/reticulum/chat-state';
  import IdentityAddressDialog from '../../features/identity/IdentityAddressDialog.svelte';
  import { toast } from '../notifications/toasts';

  let { current, children }: { current: AppRoute; children: Snippet } = $props();

  const navigation: Array<{ route: AppRoute; label: MessageKey; icon: IconName }> = [
    { route: 'chat', label: 'nav.chat', icon: 'chat' },
    { route: 'nomadnet', label: 'nav.nomadnet', icon: 'nomadnet' },
    { route: 'tools', label: 'nav.tools', icon: 'tools' },
    { route: 'settings', label: 'nav.settings', icon: 'settings' },
  ];

  function navigationItemIsActive(item: (typeof navigation)[number]): boolean {
    return current === item.route
      || ((current === 'logs' || current === 'path-management' || current === 'provisioning' || current === 'probe' || current === 'status')
        && item.route === 'tools');
  }

  const runtimeLabels: Record<typeof $runtimeStatus, MessageKey> = {
    starting: 'status.starting',
    noInterfaces: 'status.offline',
    connecting: 'status.connecting',
    online: 'status.online',
    offline: 'status.offline',
    error: 'status.error',
  };

  let addressDialogOpen = $state(false);
  let announcing = $state(false);
  let announceResult = $state<'success' | undefined>();
  let mobileIdentityActionsExpanded = $state(false);
  let mobileActionSide = $state<'left' | 'right'>('right');
  let mobileDragArmed = $state(false);
  let mobileActionsDragging = $state(false);
  let mobileActionsSnapping = $state(false);
  let mobileDragLeft = $state<string>();
  let mobileDragTop = $state<string>();
  let mobilePositionAnnouncement = $state<MessageKey>();
  let announceFeedbackTimer: number | undefined;
  let mobileLongPressTimer: number | undefined;
  let mobileSnapTimer: number | undefined;
  let mobileClickSuppressionTimer: number | undefined;
  let mobileDragPointerId: number | undefined;
  let mobileDragButton: HTMLButtonElement | undefined;
  let mobileStatusButton: HTMLButtonElement | undefined;
  let appShellElement: HTMLDivElement | undefined;
  let mobileDragOrigin: { x: number; y: number } | undefined;
  let mobileDragLatest: { x: number; y: number } | undefined;
  let mobileDragGrabOffset: { x: number; y: number } | undefined;
  let mobileDragOriginalSide: 'left' | 'right' = 'right';
  let suppressMobileRuntimeClick = false;
  const announceFeedbackDurationMs = 3_000;
  const mobileLongPressDurationMs = 550;
  const mobileLongPressMovementTolerance = 10;
  const mobileSnapDurationMs = 260;
  const lxmaAddress = $derived(
    $activeIdentity && $deliveryDestinationHash
      ? createLxmaAddress($deliveryDestinationHash, $activeIdentity.publicKeyHex)
      : undefined,
  );

  function navigationLabel(item: (typeof navigation)[number]): string {
    if (item.route !== 'chat' || $unreadChatMessageCount === 0) return $t(item.label);
    return $t(
      $unreadChatMessageCount === 1 ? 'nav.chatWithOneUnread' : 'nav.chatWithUnread',
      { count: $unreadChatMessageCount },
    );
  }

  function displayedUnreadCount(): string {
    return $unreadChatMessageCount > 99 ? '99+' : String($unreadChatMessageCount);
  }

  async function announce(): Promise<void> {
    if (announcing || $runtimeStatus !== 'online') return;
    announcing = true;
    announceResult = undefined;
    try {
      const ok = await reticulumRuntime.announceLxmf();
      if (!ok) {
        toast.error('identity.announce.failed');
        return;
      }
      announceResult = 'success';
      toast.success('identity.announce.sent');
      if (announceFeedbackTimer !== undefined) window.clearTimeout(announceFeedbackTimer);
      announceFeedbackTimer = window.setTimeout(() => { announceResult = undefined; }, announceFeedbackDurationMs);
    } catch {
      toast.error('identity.announce.failed');
    } finally {
      announcing = false;
    }
  }

  function handleMobileRuntimeStatus(event: MouseEvent): void {
    if (suppressMobileRuntimeClick) {
      event.preventDefault();
      event.stopImmediatePropagation();
      suppressMobileRuntimeClick = false;
      if (mobileClickSuppressionTimer !== undefined) window.clearTimeout(mobileClickSuppressionTimer);
      mobileClickSuppressionTimer = undefined;
      return;
    }
    if (!mobileIdentityActionsExpanded) {
      mobileIdentityActionsExpanded = true;
      return;
    }
    mobileIdentityActionsExpanded = false;
    navigateToSettingsSection('interfaces');
  }

  function releaseMobilePointerCapture(): void {
    if (!mobileDragButton || mobileDragPointerId === undefined) return;
    try {
      if (mobileDragButton.hasPointerCapture?.(mobileDragPointerId)) {
        mobileDragButton.releasePointerCapture(mobileDragPointerId);
      }
    } catch {
      // The browser may have already released capture after pointer cancellation.
    }
  }

  function clearMobileLongPress(): void {
    if (mobileLongPressTimer !== undefined) window.clearTimeout(mobileLongPressTimer);
    mobileLongPressTimer = undefined;
    mobileDragArmed = false;
  }

  function clearMobileDragPointer(): void {
    clearMobileLongPress();
    releaseMobilePointerCapture();
    mobileDragPointerId = undefined;
    mobileDragButton = undefined;
    mobileDragOrigin = undefined;
    mobileDragLatest = undefined;
    mobileDragGrabOffset = undefined;
  }

  function setMobileDragPosition(clientX: number, clientY: number): void {
    const grabOffset = mobileDragGrabOffset ?? { x: 25, y: 25 };
    mobileDragLeft = `${clientX - grabOffset.x}px`;
    mobileDragTop = `${clientY - grabOffset.y}px`;
  }

  function beginMobileDrag(): void {
    mobileLongPressTimer = undefined;
    mobileDragArmed = false;
    if (mobileDragPointerId === undefined || !mobileDragLatest) return;
    mobileIdentityActionsExpanded = false;
    mobileActionsSnapping = false;
    mobileActionsDragging = true;
    suppressMobileRuntimeClick = true;
    setMobileDragPosition(mobileDragLatest.x, mobileDragLatest.y);
  }

  function finishMobileDrag(side: 'left' | 'right'): void {
    const restsAtTop = Boolean(
      appShellElement?.querySelector('.chat-workspace.conversation-selected'),
    );
    mobileActionsDragging = false;
    mobileActionsSnapping = true;
    mobileActionSide = side;
    mobilePositionAnnouncement = side === 'left'
      ? 'identity.actions.movedLeft'
      : 'identity.actions.movedRight';
    mobileDragLeft = side === 'left'
      ? 'calc(env(safe-area-inset-left, 0px) + 12px)'
      : 'calc(100vw - env(safe-area-inset-right, 0px) - 62px)';
    mobileDragTop = restsAtTop
      ? 'calc(env(safe-area-inset-top, 0px) + 72px)'
      : 'calc(100dvh - var(--bottom-nav-height) - env(safe-area-inset-bottom, 0px) - 60px)';
    if (mobileSnapTimer !== undefined) window.clearTimeout(mobileSnapTimer);
    mobileSnapTimer = window.setTimeout(() => {
      mobileActionsSnapping = false;
      mobileDragLeft = undefined;
      mobileDragTop = undefined;
      mobileSnapTimer = undefined;
    }, mobileSnapDurationMs);
    if (mobileClickSuppressionTimer !== undefined) window.clearTimeout(mobileClickSuppressionTimer);
    mobileClickSuppressionTimer = window.setTimeout(() => {
      suppressMobileRuntimeClick = false;
      mobileClickSuppressionTimer = undefined;
    }, 500);
  }

  function handleMobileDragPointerDown(event: PointerEvent): void {
    if (event.pointerType !== 'touch' || event.button !== 0 || mobileActionsSnapping) return;
    suppressMobileRuntimeClick = false;
    if (mobileClickSuppressionTimer !== undefined) window.clearTimeout(mobileClickSuppressionTimer);
    mobileClickSuppressionTimer = undefined;
    clearMobileDragPointer();
    const button = event.currentTarget as HTMLButtonElement;
    const bounds = button.getBoundingClientRect();
    mobileDragPointerId = event.pointerId;
    mobileDragButton = button;
    mobileDragOrigin = { x: event.clientX, y: event.clientY };
    mobileDragLatest = { x: event.clientX, y: event.clientY };
    mobileDragGrabOffset = {
      x: 5 + Math.max(0, Math.min(bounds.width, event.clientX - bounds.left)),
      y: 5 + Math.max(0, Math.min(bounds.height, event.clientY - bounds.top)),
    };
    mobileDragOriginalSide = mobileActionSide;
    mobileDragArmed = true;
    try {
      button.setPointerCapture?.(event.pointerId);
    } catch {
      // Synthetic events and older WebViews may not expose pointer capture.
    }
    mobileLongPressTimer = window.setTimeout(beginMobileDrag, mobileLongPressDurationMs);
  }

  function handleMobileDragPointerMove(event: PointerEvent): void {
    if (event.pointerId !== mobileDragPointerId || !mobileDragOrigin) return;
    mobileDragLatest = { x: event.clientX, y: event.clientY };
    if (mobileActionsDragging) {
      event.preventDefault();
      setMobileDragPosition(event.clientX, event.clientY);
      return;
    }
    if (Math.hypot(event.clientX - mobileDragOrigin.x, event.clientY - mobileDragOrigin.y)
      <= mobileLongPressMovementTolerance) return;
    clearMobileDragPointer();
  }

  function handleMobileDragPointerUp(event: PointerEvent): void {
    if (event.pointerId !== mobileDragPointerId) return;
    if (mobileActionsDragging) {
      event.preventDefault();
      setMobileDragPosition(event.clientX, event.clientY);
      const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
      const side = event.clientX < viewportWidth / 2 ? 'left' : 'right';
      finishMobileDrag(side);
    }
    clearMobileDragPointer();
  }

  function handleMobileDragPointerCancel(event: PointerEvent): void {
    if (event.pointerId !== mobileDragPointerId) return;
    if (mobileActionsDragging) finishMobileDrag(mobileDragOriginalSide);
    clearMobileDragPointer();
  }

  function handleMobileRuntimeStatusKeydown(event: KeyboardEvent): void {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    mobileIdentityActionsExpanded = false;
    mobileActionSide = event.key === 'ArrowLeft' ? 'left' : 'right';
    mobilePositionAnnouncement = event.key === 'ArrowLeft'
      ? 'identity.actions.movedLeft'
      : 'identity.actions.movedRight';
    void tick().then(() => mobileStatusButton?.focus());
  }

  function collapseMobileIdentityActions(event: PointerEvent): void {
    if (!mobileIdentityActionsExpanded || mobileActionsDragging || mobileActionsSnapping) return;
    const target = event.target;
    if (target instanceof Element && target.closest('.mobile-identity-actions')) return;
    mobileIdentityActionsExpanded = false;
  }

  function announceFromMobileActions(): void {
    mobileIdentityActionsExpanded = false;
    void announce();
  }

  function openAddressFromMobileActions(): void {
    mobileIdentityActionsExpanded = false;
    addressDialogOpen = true;
  }

  onDestroy(() => {
    clearMobileDragPointer();
    if (announceFeedbackTimer !== undefined) window.clearTimeout(announceFeedbackTimer);
    if (mobileSnapTimer !== undefined) window.clearTimeout(mobileSnapTimer);
    if (mobileClickSuppressionTimer !== undefined) window.clearTimeout(mobileClickSuppressionTimer);
  });
</script>

<svelte:window onpointerdown={collapseMobileIdentityActions} />

<a class="skip-link" href="#main-content">{$t('app.skipToContent')}</a>

<div
  bind:this={appShellElement}
  class="app-shell"
  class:chat-route={current === 'chat'}
  class:mobile-actions-left={mobileActionSide === 'left'}
  class:mobile-actions-right={mobileActionSide === 'right'}
  style:--announce-feedback-duration={`${announceFeedbackDurationMs}ms`}
>
  <aside class="sidebar" aria-label={$t('nav.primary')}>
    <div class="brand-mark" aria-hidden="true"><span></span><span></span><span></span></div>
    <div class="brand-copy">
      <strong>{$t('app.name')}</strong>
      <span>{$t('app.tagline')}</span>
    </div>

    <nav class="desktop-navigation">
      {#each navigation as item}
        <button
          class:active={navigationItemIsActive(item)}
          aria-current={navigationItemIsActive(item) ? 'page' : undefined}
          aria-label={navigationLabel(item)}
          onclick={() => navigateTopLevel(item.route)}
        >
          <Icon name={item.icon} size={21} />
          <span class="navigation-copy">
            <span class="navigation-label">{$t(item.label)}</span>
            {#if item.route === 'chat' && $unreadChatMessageCount > 0}
              <span class="navigation-unread-badge" aria-hidden="true">{displayedUnreadCount()}</span>
            {/if}
          </span>
        </button>
      {/each}
    </nav>

    <div class="sidebar-identity-actions">
      <button
        class="sidebar-announce-button"
        class:announce-feedback-success={announceResult === 'success'}
        type="button"
        disabled={$runtimeStatus !== 'online' || announcing}
        title={$t($runtimeStatus === 'online' ? 'identity.announce.manual' : 'identity.announce.offline')}
        onclick={announce}
      >
        <Icon name="announce" size={18} />
        <span>{$t(announcing ? 'identity.announce.sending' : announceResult === 'success' ? 'identity.announce.sent' : 'identity.announce.manual')}</span>
      </button>
      <button
        class="sidebar-qr-button"
        type="button"
        disabled={!lxmaAddress}
        title={$t('identity.address.open')}
        aria-label={$t('identity.address.open')}
        onclick={() => { addressDialogOpen = true; }}
      ><Icon name="qr" size={19} /></button>
    </div>

    <button class="sidebar-status" onclick={() => navigateToSettingsSection('interfaces')} aria-label={$t('status.openInterfaceSettings')}>
      <span
        class="status-dot"
        class:online={$runtimeStatus === 'online'}
        class:connecting={$runtimeStatus === 'connecting' || $runtimeStatus === 'starting'}
        class:error={$runtimeStatus === 'error'}
      ></span>
      <div>
        <strong>{$t(runtimeLabels[$runtimeStatus])}</strong>
        <span>
          {$t($runtimeStatus === 'noInterfaces'
            ? 'status.noInterfaces'
            : $runtimeStatus === 'online'
              ? 'status.interfacesActive'
              : 'status.interfacesConfigured')}
        </span>
      </div>
    </button>
  </aside>

  <main id="main-content" tabindex="-1">
    {@render children()}
  </main>

  {#snippet mobileAnnounceButton()}
    <button
      class="icon-button"
      class:announce-feedback-success={announceResult === 'success'}
      type="button"
      disabled={$runtimeStatus !== 'online' || announcing}
      title={$t($runtimeStatus === 'online' ? 'identity.announce.manual' : 'identity.announce.offline')}
      aria-label={$t('identity.announce.manual')}
      onclick={announceFromMobileActions}
    ><Icon name="announce" size={19} /></button>
  {/snippet}

  {#snippet mobileAddressButton()}
    <button
      class="icon-button mobile-address-button"
      type="button"
      disabled={!lxmaAddress}
      title={$t('identity.address.open')}
      aria-label={$t('identity.address.open')}
      onclick={openAddressFromMobileActions}
    ><Icon name="qr" size={19} /></button>
  {/snippet}

  {#snippet mobileRuntimeStatusButton()}
    <button
      bind:this={mobileStatusButton}
      class="icon-button mobile-runtime-status"
      type="button"
      title={$t(mobileIdentityActionsExpanded ? 'status.openInterfaceSettings' : 'identity.actions.show')}
      aria-label={$t(
        mobileIdentityActionsExpanded ? 'status.openInterfaceSettingsWithStatus' : 'identity.actions.showWithStatus',
        { status: $t(runtimeLabels[$runtimeStatus]) },
      )}
      aria-describedby="mobile-runtime-status-drag-hint"
      aria-expanded={mobileIdentityActionsExpanded}
      aria-keyshortcuts="ArrowLeft ArrowRight"
      onclick={handleMobileRuntimeStatus}
      onkeydown={handleMobileRuntimeStatusKeydown}
      onpointerdown={handleMobileDragPointerDown}
      onpointermove={handleMobileDragPointerMove}
      onpointerup={handleMobileDragPointerUp}
      onpointercancel={handleMobileDragPointerCancel}
      oncontextmenu={(event) => event.preventDefault()}
    >
      <span
        class="status-dot"
        class:online={$runtimeStatus === 'online'}
        class:connecting={$runtimeStatus === 'connecting' || $runtimeStatus === 'starting'}
        class:error={$runtimeStatus === 'error'}
      ></span>
    </button>
  {/snippet}

  <div
    class="mobile-identity-actions"
    class:expanded={mobileIdentityActionsExpanded}
    class:side-left={mobileActionSide === 'left'}
    class:side-right={mobileActionSide === 'right'}
    class:drag-armed={mobileDragArmed}
    class:dragging={mobileActionsDragging}
    class:snapping={mobileActionsSnapping}
    data-side={mobileActionSide}
    data-dragging={mobileActionsDragging ? 'true' : undefined}
    style:--mobile-actions-drag-left={mobileDragLeft}
    style:--mobile-actions-drag-top={mobileDragTop}
  >
    {#if mobileActionSide === 'left'}
      {@render mobileRuntimeStatusButton()}
      {#if mobileIdentityActionsExpanded}
        {@render mobileAddressButton()}
        {@render mobileAnnounceButton()}
      {/if}
    {:else}
      {#if mobileIdentityActionsExpanded}
        {@render mobileAnnounceButton()}
        {@render mobileAddressButton()}
      {/if}
      {@render mobileRuntimeStatusButton()}
    {/if}
  </div>

  <span id="mobile-runtime-status-drag-hint" class="sr-only">
    {$t('identity.actions.dragHint')}
  </span>
  <span class="sr-only" aria-live="polite">
    {mobilePositionAnnouncement ? $t(mobilePositionAnnouncement) : ''}
  </span>

  <nav class="bottom-navigation" aria-label={$t('nav.primary')}>
    {#each navigation as item}
      <button
        class:active={navigationItemIsActive(item)}
        aria-current={navigationItemIsActive(item) ? 'page' : undefined}
        aria-label={navigationLabel(item)}
        onclick={() => navigateTopLevel(item.route)}
      >
        <Icon name={item.icon} size={22} />
        <span class="navigation-copy">
          <span class="navigation-label">{$t(item.label)}</span>
          {#if item.route === 'chat' && $unreadChatMessageCount > 0}
            <span class="navigation-unread-badge" aria-hidden="true">{displayedUnreadCount()}</span>
          {/if}
        </span>
      </button>
    {/each}
  </nav>
</div>

{#if addressDialogOpen && lxmaAddress && $deliveryDestinationHash}
  <IdentityAddressDialog
    address={lxmaAddress}
    destinationHash={$deliveryDestinationHash}
    onclose={() => { addressDialogOpen = false; }}
  />
{/if}
