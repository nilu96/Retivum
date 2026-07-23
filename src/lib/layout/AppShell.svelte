<script lang="ts">
  import type { Snippet } from 'svelte';
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
      || ((current === 'logs' || current === 'provisioning' || current === 'probe' || current === 'status')
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
  let announceFeedbackTimer: number | undefined;
  const announceFeedbackDurationMs = 3_000;
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

  function handleMobileRuntimeStatus(): void {
    if (!mobileIdentityActionsExpanded) {
      mobileIdentityActionsExpanded = true;
      return;
    }
    mobileIdentityActionsExpanded = false;
    navigateToSettingsSection('interfaces');
  }

  function collapseMobileIdentityActions(event: PointerEvent): void {
    if (!mobileIdentityActionsExpanded) return;
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
</script>

<svelte:window onpointerdown={collapseMobileIdentityActions} />

<a class="skip-link" href="#main-content">{$t('app.skipToContent')}</a>

<div
  class="app-shell"
  class:chat-route={current === 'chat'}
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

  <div class="mobile-identity-actions" class:expanded={mobileIdentityActionsExpanded}>
    {#if mobileIdentityActionsExpanded}
      <button
        class="icon-button"
        class:announce-feedback-success={announceResult === 'success'}
        type="button"
        disabled={$runtimeStatus !== 'online' || announcing}
        title={$t($runtimeStatus === 'online' ? 'identity.announce.manual' : 'identity.announce.offline')}
        aria-label={$t('identity.announce.manual')}
        onclick={announceFromMobileActions}
      ><Icon name="announce" size={19} /></button>
      <button
        class="icon-button mobile-address-button"
        type="button"
        disabled={!lxmaAddress}
        title={$t('identity.address.open')}
        aria-label={$t('identity.address.open')}
        onclick={openAddressFromMobileActions}
      ><Icon name="qr" size={19} /></button>
    {/if}
    <button
      class="icon-button mobile-runtime-status"
      type="button"
      title={$t(mobileIdentityActionsExpanded ? 'status.openInterfaceSettings' : 'identity.actions.show')}
      aria-label={$t(
        mobileIdentityActionsExpanded ? 'status.openInterfaceSettingsWithStatus' : 'identity.actions.showWithStatus',
        { status: $t(runtimeLabels[$runtimeStatus]) },
      )}
      aria-expanded={mobileIdentityActionsExpanded}
      onclick={handleMobileRuntimeStatus}
    >
      <span
        class="status-dot"
        class:online={$runtimeStatus === 'online'}
        class:connecting={$runtimeStatus === 'connecting' || $runtimeStatus === 'starting'}
        class:error={$runtimeStatus === 'error'}
      ></span>
    </button>
  </div>

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
