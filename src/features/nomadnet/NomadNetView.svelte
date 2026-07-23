<script lang="ts">
  import { createDateFormatter, locale, t, type MessageKey } from '../../i18n';
  import {
    NOMAD_DEFAULT_PAGE_PATH,
    formatNomadAddress,
    nomadRequestPath,
    parseNomadAddress,
    resolveNomadLink,
    type NomadBookmark,
    type NomadPage,
    type NomadPageLoadStage,
    type NomadPageLoadUpdate,
    type NomadRequestData,
  } from '../../domain/nomadnet';
  import {
    activeIdentity,
    destinationPathStatuses,
    nomadAnnounces,
    nomadBookmarks,
    reticulumRuntime,
  } from '../../infrastructure/reticulum/runtime';
  import EmptyState from '../../lib/components/EmptyState.svelte';
  import ContextMenu from '../../lib/components/ContextMenu.svelte';
  import ConfirmationDialog from '../../lib/components/ConfirmationDialog.svelte';
  import Icon from '../../lib/components/Icon.svelte';
  import PathStatus from '../../lib/components/PathStatus.svelte';
  import {
    contextMenuTrigger,
    type ContextMenuOpenMethod,
  } from '../../lib/actions/contextMenuTrigger';
  import { copyText } from '../../lib/clipboard';
  import MicronPage from './MicronPage.svelte';
  import NomadBookmarkEditor from './NomadBookmarkEditor.svelte';
  import { toast } from '../../lib/notifications/toasts';

  type LoadedNomadPage = NomadPage & { identifyBeforeLoad?: boolean };
  type NomadPageRequest = {
    destinationHash: string;
    path: string;
    requestData: NomadRequestData;
    identifyBeforeLoad: boolean;
    mode: 'push' | 'replace';
    freshLink: boolean;
  };
  type DestinationActionTarget = {
    destinationHash: string;
    path: string;
    requestData: NomadRequestData;
    suggestedName: string;
    bookmarkId?: string;
  };

  let address = $state('');
  let scope = $state<'announces' | 'bookmarks'>('announces');
  let query = $state('');
  let directoryExpanded = $state(true);
  let loadedPage = $state<LoadedNomadPage>();
  let loadingPage = $state(false);
  let pendingPageRequest = $state<NomadPageRequest>();
  let failedPageRequest = $state<NomadPageRequest>();
  let sharingIdentity = $state(false);
  let identityShareConfirmationOpen = $state(false);
  let pageError = $state<'load' | 'link'>();
  let pageErrorCode = $state<string>();
  let loadingStage = $state<NomadPageLoadStage | 'preparing'>('preparing');
  let loadingProgress = $state<number>();
  let loadingDataSize = $state<number>();
  let navigationHistory = $state<LoadedNomadPage[]>([]);
  let navigationSequence = 0;
  const maximumNavigationHistoryEntries = 32;
  const identityReloadDelayMs = 500;
  let bookmarkEditor = $state<{
    address: string;
    currentName: string;
    currentIdentifyBeforeLoad: boolean;
    bookmarkId?: string;
  }>();
  let destinationActions = $state<(DestinationActionTarget & {
    x: number;
    y: number;
    autofocus: boolean;
    guardOpeningRelease: boolean;
  }) | undefined>();

  const parsedAddress = $derived(parseNomadAddress(address));
  const currentPageTarget = $derived(pendingPageRequest ?? failedPageRequest ?? loadedPage);
  const canGoBack = $derived(loadingPage
    ? Boolean(loadedPage)
    : Boolean((pageError === 'load' && failedPageRequest && loadedPage) || navigationHistory.length));
  const canGoHome = $derived(Boolean(
    currentPageTarget
      && nomadRequestPath(currentPageTarget.path) !== NOMAD_DEFAULT_PAGE_PATH,
  ));
  const currentBookmark = $derived(parsedAddress
    ? $nomadBookmarks.find((item) =>
      item.destinationHash === parsedAddress.destinationHash
        && nomadRequestPath(item.path) === nomadRequestPath(parsedAddress.path)
        && sameRequestData(item.requestData ?? {}, parsedAddress.requestData),
    )
    : undefined);
  const normalizedQuery = $derived(query.trim().toLowerCase());
  const filteredAnnounces = $derived(
    $nomadAnnounces.filter((item) => item.destinationHash.includes(normalizedQuery)),
  );
  const filteredBookmarks = $derived(
    $nomadBookmarks.filter((item) =>
      [
        item.label,
        item.destinationHash,
        formatNomadAddress(item.destinationHash, item.path, item.requestData ?? {}),
      ].some((value) => value?.toLowerCase().includes(normalizedQuery)),
    ),
  );
  const visibleDestinationCount = $derived(
    scope === 'announces' ? filteredAnnounces.length : filteredBookmarks.length,
  );
  const heardAtFormatter = $derived(createDateFormatter($locale));
  const destinationActionBookmark = $derived(destinationActions?.bookmarkId
    ? $nomadBookmarks.find((bookmark) => bookmark.id === destinationActions?.bookmarkId)
    : undefined);

  const scopes: Array<{ id: 'announces' | 'bookmarks'; label: MessageKey; searchName: MessageKey }> = [
    { id: 'announces', label: 'nomadnet.scope.announces', searchName: 'nomadnet.scope.announces.searchName' },
    { id: 'bookmarks', label: 'nomadnet.scope.bookmarks', searchName: 'nomadnet.scope.bookmarks.searchName' },
  ];

  function isCurrentPage(
    destinationHash: string,
    path: string,
    requestData: NomadRequestData = {},
  ): boolean {
    return currentPageTarget?.destinationHash === destinationHash
      && nomadRequestPath(currentPageTarget.path) === nomadRequestPath(path)
      && sameRequestData(currentPageTarget.requestData ?? {}, requestData);
  }

  function isCurrentDestination(destinationHash: string): boolean {
    return currentPageTarget?.destinationHash === destinationHash;
  }

  function bookmarkForPage(
    destinationHash: string,
    path: string,
    requestData: NomadRequestData = {},
  ): NomadBookmark | undefined {
    return $nomadBookmarks.find((item) =>
      item.destinationHash === destinationHash
        && nomadRequestPath(item.path) === nomadRequestPath(path)
        && sameRequestData(item.requestData ?? {}, requestData));
  }

  function destinationActionTarget(
    destinationHash: string,
    path = '/',
    requestData: NomadRequestData = {},
    suggestedName = '',
    bookmarkId?: string,
  ): DestinationActionTarget {
    return {
      destinationHash,
      path: nomadRequestPath(path),
      requestData: { ...requestData },
      suggestedName,
      bookmarkId,
    };
  }

  function openDestinationActions(
    target: DestinationActionTarget,
    clientX: number,
    clientY: number,
    method: ContextMenuOpenMethod,
  ): void {
    const bookmarkId = target.bookmarkId
      ?? bookmarkForPage(target.destinationHash, target.path, target.requestData)?.id;
    destinationActions = {
      ...target,
      bookmarkId,
      x: clientX,
      y: clientY,
      autofocus: method === 'keyboard',
      guardOpeningRelease: method === 'longpress',
    };
  }

  function closeDestinationActions(): void {
    destinationActions = undefined;
  }

  function destinationRowClick(target: DestinationActionTarget): void {
    openDirectoryDestination(target.destinationHash, target.path, target.requestData);
  }

  async function copyDestinationHash(destinationHash: string): Promise<void> {
    closeDestinationActions();
    if (await copyText(destinationHash)) toast.success('common.copied');
    else toast.error('common.copyFailed');
  }

  function addDestinationBookmark(): void {
    if (!destinationActions || !$activeIdentity) return;
    const target = destinationActions;
    closeDestinationActions();
    bookmarkEditor = {
      address: formatNomadAddress(target.destinationHash, target.path, target.requestData),
      currentName: target.suggestedName,
      currentIdentifyBeforeLoad: false,
    };
  }

  async function openDestination(
    destinationHash: string,
    path = '/',
    mode: 'push' | 'replace' = 'push',
    requestData: NomadRequestData = {},
    freshLink = false,
    identifyBeforeLoad = false,
  ): Promise<boolean> {
    const requestPath = nomadRequestPath(path);
    // Values read back from Svelte state can be proxies, which cannot be sent
    // through Worker.postMessage. Keep the runtime boundary cloneable.
    const plainRequestData = { ...requestData };
    address = formatNomadAddress(destinationHash, requestPath, plainRequestData);
    const previousPage = loadedPage;
    const sequence = ++navigationSequence;
    const request: NomadPageRequest = {
      destinationHash,
      path: requestPath,
      requestData: plainRequestData,
      identifyBeforeLoad,
      mode,
      freshLink,
    };
    pendingPageRequest = request;
    failedPageRequest = undefined;
    loadingPage = true;
    loadingStage = 'preparing';
    loadingProgress = undefined;
    loadingDataSize = undefined;
    pageError = undefined;
    pageErrorCode = undefined;
    try {
      const onUpdate = (update: NomadPageLoadUpdate) => handlePageLoadUpdate(sequence, update);
      const nextPage = freshLink
        ? identifyBeforeLoad
          ? await reticulumRuntime.requestNomadPage(
              destinationHash,
              requestPath,
              plainRequestData,
              onUpdate,
              true,
              true,
            )
          : await reticulumRuntime.requestNomadPage(
              destinationHash,
              requestPath,
              plainRequestData,
              onUpdate,
              true,
            )
        : identifyBeforeLoad
          ? await reticulumRuntime.requestNomadPage(
              destinationHash,
              requestPath,
              plainRequestData,
              onUpdate,
              false,
              true,
            )
        : await reticulumRuntime.requestNomadPage(
            destinationHash,
            requestPath,
            plainRequestData,
            onUpdate,
          );
      if (sequence !== navigationSequence) return false;
      if (!nextPage) {
        pageError = 'load';
        failedPageRequest = request;
        return false;
      }
      const nextRequestData = nextPage.requestData ?? {};
      if (
        mode === 'push'
        && previousPage
        && (previousPage.destinationHash !== nextPage.destinationHash
          || nomadRequestPath(previousPage.path) !== nomadRequestPath(nextPage.path)
          || !sameRequestData(previousPage.requestData ?? {}, nextRequestData))
      ) {
        navigationHistory = [...navigationHistory, {
          ...previousPage,
          path: nomadRequestPath(previousPage.path),
          requestData: { ...(previousPage.requestData ?? {}) },
        }].slice(-maximumNavigationHistoryEntries);
      }
      directoryExpanded = false;
      loadedPage = { ...nextPage, requestData: nextRequestData, identifyBeforeLoad };
      address = formatNomadAddress(nextPage.destinationHash, nextPage.path, nextRequestData);
      return true;
    } catch {
      if (sequence === navigationSequence) {
        pageError = 'load';
        pageErrorCode = 'NOMAD_REQUEST_FAILED';
        failedPageRequest = request;
      }
      return false;
    } finally {
      if (sequence === navigationSequence) {
        loadingPage = false;
        pendingPageRequest = undefined;
      }
    }
  }

  function openDirectoryDestination(
    destinationHash: string,
    path = '/',
    requestData: NomadRequestData = {},
  ): void {
    directoryExpanded = false;
    const bookmark = bookmarkForPage(destinationHash, path, requestData);
    void openDestination(
      destinationHash,
      path,
      'push',
      requestData,
      false,
      bookmark?.identifyBeforeLoad === true,
    );
  }

  function submitAddress(event: SubmitEvent): void {
    event.preventDefault();
    if (parsedAddress) {
      directoryExpanded = false;
      void openDestination(
        parsedAddress.destinationHash,
        parsedAddress.path,
        'push',
        parsedAddress.requestData,
        false,
        currentBookmark?.identifyBeforeLoad === true,
      );
    }
  }

  function openPageLink(target: string, submittedFields: NomadRequestData): void {
    if (!loadedPage) return;
    const next = resolveNomadLink(loadedPage.destinationHash, target);
    if (!next) {
      pageError = 'link';
      pageErrorCode = undefined;
      return;
    }
    void openDestination(next.destinationHash, next.path, 'push', {
      ...next.requestData,
      ...submittedFields,
    }, false, next.destinationHash === loadedPage.destinationHash && loadedPage.identifyBeforeLoad === true);
  }

  function retryPage(): void {
    if (failedPageRequest) void openDestination(
      failedPageRequest.destinationHash,
      failedPageRequest.path,
      failedPageRequest.mode,
      failedPageRequest.requestData,
      failedPageRequest.freshLink,
      failedPageRequest.identifyBeforeLoad,
    );
  }

  function reloadPage(): void {
    const activeRequest = pendingPageRequest ?? failedPageRequest;
    const target = activeRequest ?? (loadedPage ? {
      destinationHash: loadedPage.destinationHash,
      path: loadedPage.path,
      requestData: loadedPage.requestData,
      identifyBeforeLoad: loadedPage.identifyBeforeLoad === true,
    } : undefined);
    if (!target) return;
    void openDestination(
      target.destinationHash,
      target.path,
      activeRequest?.mode ?? 'replace',
      target.requestData,
      true,
      target.identifyBeforeLoad === true,
    );
  }

  async function shareIdentity(): Promise<void> {
    if (!loadedPage || sharingIdentity) return;
    sharingIdentity = true;
    try {
      const identifiedPage = loadedPage;
      const identityResult = reticulumRuntime.identifyNomadLink(identifiedPage.destinationHash)
        .catch(() => false);
      await new Promise<void>((resolve) => setTimeout(resolve, identityReloadDelayMs));
      const reloadResult = openDestination(
        identifiedPage.destinationHash,
        identifiedPage.path,
        'replace',
        { ...(identifiedPage.requestData ?? {}) },
        false,
        identifiedPage.identifyBeforeLoad === true,
      ).catch(() => false);
      const [identified, reloaded] = await Promise.all([identityResult, reloadResult]);
      if (!identified) {
        toast.error('nomadnet.page.identityShareError');
        return;
      }
      if (!reloaded) toast.error(pageErrorCode === 'NOMAD_IDENTITY_SHARE_FAILED'
        ? 'nomadnet.page.identityShareError'
        : 'nomadnet.page.identitySharedReloadError');
    } catch {
      toast.error('nomadnet.page.identityShareError');
    } finally {
      sharingIdentity = false;
    }
  }

  function confirmIdentityShare(): void {
    identityShareConfirmationOpen = false;
    void shareIdentity();
  }

  function goBack(): void {
    if (cancelPendingPageLoad()) return;
    if (pageError === 'load' && failedPageRequest && loadedPage) {
      failedPageRequest = undefined;
      pageError = undefined;
      pageErrorCode = undefined;
      directoryExpanded = false;
      address = formatNomadAddress(
        loadedPage.destinationHash,
        loadedPage.path,
        loadedPage.requestData ?? {},
      );
      return;
    }
    const previous = navigationHistory.at(-1);
    if (!previous) return;
    navigationSequence += 1;
    navigationHistory = navigationHistory.slice(0, -1);
    pendingPageRequest = undefined;
    failedPageRequest = undefined;
    loadingPage = false;
    pageError = undefined;
    pageErrorCode = undefined;
    directoryExpanded = false;
    loadedPage = {
      ...previous,
      requestData: { ...(previous.requestData ?? {}) },
    };
    address = formatNomadAddress(previous.destinationHash, previous.path, previous.requestData ?? {});
  }

  function cancelPendingPageLoad(): boolean {
    if (!loadingPage || !pendingPageRequest) return false;
    reticulumRuntime.cancelNomadPage(pendingPageRequest.destinationHash);
    navigationSequence += 1;
    pendingPageRequest = undefined;
    loadingPage = false;
    pageError = undefined;
    pageErrorCode = undefined;
    directoryExpanded = false;
    if (loadedPage) {
      address = formatNomadAddress(
        loadedPage.destinationHash,
        loadedPage.path,
        loadedPage.requestData ?? {},
      );
    }
    return true;
  }

  function sameRequestData(left: NomadRequestData, right: NomadRequestData): boolean {
    const leftEntries = Object.entries(left);
    const rightEntries = Object.entries(right);
    return leftEntries.length === rightEntries.length
      && leftEntries.every(([key, value]) => right[key] === value);
  }

  function handlePageLoadUpdate(sequence: number, update: NomadPageLoadUpdate): void {
    if (sequence !== navigationSequence) return;
    if (update.type === 'failed') {
      if (update.code !== 'NOMAD_PAGE_CANCELLED') pageErrorCode = update.code;
      return;
    }
    loadingStage = update.stage;
    loadingProgress = update.progress;
    loadingDataSize = update.dataSize;
  }

  function loadingBody(): string {
    const key: MessageKey = loadingStage === 'findingPath'
      ? 'nomadnet.page.loading.findingPath'
      : loadingStage === 'establishingLink'
        ? 'nomadnet.page.loading.establishingLink'
        : loadingStage === 'requestingPage'
          ? 'nomadnet.page.loading.requestingPage'
          : loadingStage === 'receivingPage'
            ? 'nomadnet.page.loading.receivingPage'
            : 'nomadnet.page.loading.preparing';
    return $t(key);
  }

  function loadingHint(): string | undefined {
    const percent = loadingProgress === undefined ? undefined : Math.round(loadingProgress * 100);
    const size = loadingDataSize === undefined ? undefined : formatBytes(loadingDataSize);
    if (percent !== undefined && size) return $t('nomadnet.page.loading.progressSize', { percent, size });
    if (percent !== undefined) return $t('nomadnet.page.loading.progress', { percent });
    if (size) return $t('nomadnet.page.loading.size', { size });
    return undefined;
  }

  function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function pageLoadErrorMessage(code: string | undefined): MessageKey {
    if (code === 'NOMAD_DESTINATION_UNKNOWN') return 'nomadnet.page.error.destinationUnknown';
    if (code === 'NOMAD_PATH_REQUEST_FAILED' || code === 'NOMAD_PATH_REQUEST_TIMEOUT') {
      return 'nomadnet.page.error.path';
    }
    if (code === 'NOMAD_LINK_ESTABLISHMENT_FAILED') return 'nomadnet.page.error.linkEstablishment';
    if (code === 'NOMAD_IDENTITY_SHARE_FAILED') return 'nomadnet.page.error.identify';
    if (code === 'NOMAD_PAGE_LOAD_TIMEOUT') return 'nomadnet.page.error.deadline';
    if (code === 'NOMAD_LINK_FAILED' || code === 'NOMAD_LINK_CLOSED') return 'nomadnet.page.error.link';
    if (code === 'NOMAD_REQUEST_FAILED' || code === 'NOMAD_REQUEST_TIMEOUT') return 'nomadnet.page.error.request';
    if (code === 'NOMAD_RESOURCE_FAILED') return 'nomadnet.page.error.transfer';
    if (code === 'NOMAD_PAGE_TOO_LARGE') return 'nomadnet.page.error.tooLarge';
    if (code === 'NOMAD_PAGE_RESPONSE_INVALID' || code === 'NOMAD_PAGE_INVALID_UTF8') {
      return 'nomadnet.page.error.invalidResponse';
    }
    if (code === 'NOMAD_RUNTIME_UNAVAILABLE' || code === 'NOMAD_RUNTIME_RESET') {
      return 'nomadnet.page.error.runtime';
    }
    return 'nomadnet.page.error.body';
  }

  function goHome(): void {
    const target = pendingPageRequest ?? failedPageRequest ?? loadedPage;
    if (!target || !canGoHome) return;
    if (pendingPageRequest) reticulumRuntime.cancelNomadPage(pendingPageRequest.destinationHash);
    void openDestination(
      target.destinationHash,
      NOMAD_DEFAULT_PAGE_PATH,
      'push',
      {},
      false,
      target.identifyBeforeLoad === true,
    );
  }

  function homeOrCancel(): void {
    if (loadingPage) {
      cancelPendingPageLoad();
      return;
    }
    goHome();
  }

  function bookmarkCurrent(): void {
    if (!parsedAddress || currentBookmark) return;
    const announcedName = $nomadAnnounces.find((item) => (
      item.destinationHash === parsedAddress.destinationHash
    ))?.displayName;
    bookmarkEditor = {
      address: formatNomadAddress(
        parsedAddress.destinationHash,
        parsedAddress.path,
        parsedAddress.requestData,
      ),
      currentName: announcedName ?? '',
      currentIdentifyBeforeLoad: false,
    };
  }

  function editBookmark(bookmark: NomadBookmark): void {
    bookmarkEditor = {
      address: formatNomadAddress(bookmark.destinationHash, bookmark.path, bookmark.requestData ?? {}),
      currentName: bookmark.label ?? '',
      currentIdentifyBeforeLoad: bookmark.identifyBeforeLoad === true,
      bookmarkId: bookmark.id,
    };
  }

  async function saveBookmark(name: string, identifyBeforeLoad: boolean): Promise<boolean> {
    if (!bookmarkEditor) return false;
    return bookmarkEditor.bookmarkId
      ? await reticulumRuntime.updateNomadBookmark(bookmarkEditor.bookmarkId, name, identifyBeforeLoad)
      : await reticulumRuntime.addNomadBookmark(bookmarkEditor.address, name, identifyBeforeLoad);
  }

  async function removeBookmark(id: string): Promise<void> {
    try {
      await reticulumRuntime.deleteNomadBookmark(id);
    } catch {
      toast.error('nomadnet.directory.error');
    }
  }
</script>

<div class="page nomad-page">
  <header class="page-header nomad-header">
    <div>
      <p class="eyebrow">{$t('app.name')}</p>
      <h1>{$t('nomadnet.title')}</h1>
      <p>{$t('nomadnet.subtitle')}</p>
    </div>
    <div class="header-actions">
      <button
        class="icon-button"
        aria-label={$t(sharingIdentity ? 'nomadnet.page.sharingIdentity' : 'nomadnet.page.shareIdentity')}
        title={$t(sharingIdentity ? 'nomadnet.page.sharingIdentity' : 'nomadnet.page.shareIdentity')}
        disabled={!loadedPage || loadingPage || sharingIdentity}
        onclick={() => { identityShareConfirmationOpen = true; }}
      ><Icon name="fingerprint" size={19} /></button>
      <button
        class="icon-button"
        aria-label={$t('nomadnet.page.reload')}
        title={$t('nomadnet.page.reload')}
        disabled={!loadedPage && !pendingPageRequest && !failedPageRequest}
        onclick={reloadPage}
      ><Icon name="sync" size={19} /></button>
      <button
        class="icon-button"
        class:primary={Boolean(parsedAddress) && !currentBookmark}
        aria-label={$t(currentBookmark ? 'nomadnet.alreadyBookmarked' : 'nomadnet.bookmarkCurrent')}
        title={$t(currentBookmark ? 'nomadnet.alreadyBookmarked' : 'nomadnet.bookmarkCurrent')}
        disabled={!parsedAddress || !$activeIdentity || Boolean(currentBookmark)}
        onclick={bookmarkCurrent}
      ><Icon name="bookmark" size={19} /></button>
    </div>
  </header>

  <form class="nomad-address" onsubmit={submitAddress}>
    <div class="nomad-browser-actions">
      <button
        class="icon-button"
        type="button"
        aria-label={$t('nomadnet.page.back')}
        title={$t('nomadnet.page.back')}
        disabled={!canGoBack}
        onclick={goBack}
      ><Icon name="arrow-left" size={19} /></button>
      <button
        class="icon-button"
        type="button"
        aria-label={$t(loadingPage ? 'nomadnet.page.cancelLoading' : 'nomadnet.page.home')}
        title={$t(loadingPage ? 'nomadnet.page.cancelLoading' : 'nomadnet.page.home')}
        disabled={!loadingPage && !canGoHome}
        onclick={homeOrCancel}
      ><Icon name={loadingPage ? 'close' : 'home'} size={19} /></button>
    </div>
    <label>
      <span class="sr-only">{$t('nomadnet.address.label')}</span>
      <Icon name="nomadnet" size={19} />
      <input bind:value={address} placeholder={$t('nomadnet.address.placeholder')} autocapitalize="none" spellcheck="false" />
    </label>
    <button class="button primary" type="submit" disabled={!parsedAddress || loadingPage}>
      {$t(loadingPage ? 'nomadnet.page.loading.short' : 'nomadnet.go')}<Icon name="arrow-right" size={17} />
    </button>
  </form>

  <div class="nomad-workspace">
    <aside class:expanded={directoryExpanded} class="nomad-directory">
      <div class="scope-tabs" role="tablist" aria-label={$t('nomadnet.scopes.label')}>
        {#each scopes as item}
          <button
            role="tab"
            aria-selected={scope === item.id}
            class:active={scope === item.id}
            onclick={() => { scope = item.id; query = ''; }}
          >{$t(item.label)}</button>
        {/each}
      </div>
      <label class="search-field">
        <Icon name="search" size={18} />
        <span class="sr-only">{$t('nomadnet.search.label', { scope: $t(scopes.find((item) => item.id === scope)?.searchName ?? 'nomadnet.scope.announces.searchName') })}</span>
        <input
          bind:value={query}
          type="search"
          placeholder={$t('nomadnet.search.placeholder', { scope: $t(scopes.find((item) => item.id === scope)?.searchName ?? 'nomadnet.scope.announces.searchName') })}
          onfocus={() => { directoryExpanded = true; }}
        />
      </label>
      <button
        class="nomad-directory-toggle"
        type="button"
        aria-controls="nomad-destination-results"
        aria-expanded={directoryExpanded}
        onclick={() => { directoryExpanded = !directoryExpanded; }}
      >
        {#if directoryExpanded}<Icon name="chevron-down" size={17} />{/if}
        <span>{$t(directoryExpanded ? 'nomadnet.directory.hide' : 'nomadnet.directory.show', {
          count: visibleDestinationCount,
          scope: $t(scope === 'announces'
            ? 'nomadnet.scope.announces.searchName'
            : 'nomadnet.scope.bookmarks.searchName'),
        })}</span>
        {#if !directoryExpanded}<Icon name="chevron-down" size={17} />{/if}
      </button>
      <div id="nomad-destination-results" class="nomad-directory-content" role="tabpanel">
        {#if scope === 'announces' && filteredAnnounces.length}
          <div class="nomad-destination-list">
            {#each filteredAnnounces as announce (announce.id)}
              {@const current = isCurrentDestination(announce.destinationHash)}
              {@const actionTarget = destinationActionTarget(
                announce.destinationHash,
                '/',
                {},
                announce.displayName ?? '',
              )}
              <button
                class="nomad-destination"
                class:active={current}
                aria-current={current ? 'page' : undefined}
                aria-haspopup="menu"
                title={$t('nomadnet.destination.actions.open')}
                onclick={() => destinationRowClick(actionTarget)}
                use:contextMenuTrigger={{
                  onopen: (x, y, method) => openDestinationActions(actionTarget, x, y, method),
                }}
              >
                <span class="destination-mark"><Icon name="network" size={17} /></span>
                <span>
                  {#if announce.displayName}<strong>{announce.displayName}</strong>{/if}
                  <code>{announce.destinationHash}</code>
                  <small>{$t('nomadnet.announce.heardAt', { date: heardAtFormatter.format(new Date(announce.heardAt)) })}</small>
                </span>
                <span class="directory-row-route">
                  <PathStatus status={$destinationPathStatuses[announce.destinationHash]} />
                  <Icon name="arrow-right" size={16} />
                </span>
              </button>
            {/each}
          </div>
        {:else if scope === 'bookmarks' && filteredBookmarks.length}
          <div class="nomad-destination-list">
            {#each filteredBookmarks as bookmark (bookmark.id)}
              {@const current = isCurrentPage(bookmark.destinationHash, bookmark.path, bookmark.requestData ?? {})}
              {@const actionTarget = destinationActionTarget(
                bookmark.destinationHash,
                bookmark.path,
                bookmark.requestData ?? {},
                bookmark.label ?? '',
                bookmark.id,
              )}
              <div class="nomad-bookmark-row" class:active={current}>
                <button
                  class="nomad-destination"
                  aria-current={current ? 'page' : undefined}
                  aria-haspopup="menu"
                  title={$t('nomadnet.destination.actions.open')}
                  onclick={() => destinationRowClick(actionTarget)}
                  use:contextMenuTrigger={{
                    onopen: (x, y, method) => openDestinationActions(actionTarget, x, y, method),
                  }}
                >
                  <span class="destination-mark"><Icon name="bookmark" size={17} /></span>
                  <span>
                    {#if bookmark.label}<strong>{bookmark.label}</strong>{/if}
                    <code>{bookmark.destinationHash}</code>
                    <small>{formatNomadAddress(bookmark.destinationHash, bookmark.path, bookmark.requestData ?? {}).slice(bookmark.destinationHash.length + 1)}</small>
                  </span>
                  <span class="directory-row-route">
                    <PathStatus status={$destinationPathStatuses[bookmark.destinationHash]} />
                    <Icon name="arrow-right" size={16} />
                  </span>
                </button>
                <div class="bookmark-actions">
                  <button onclick={() => editBookmark(bookmark)}>
                    <Icon name="edit" size={14} />{$t('nomadnet.bookmark.edit')}
                  </button>
                  <button class="danger" onclick={() => removeBookmark(bookmark.id)}>
                    <Icon name="trash" size={14} />{$t('common.delete')}
                  </button>
                </div>
              </div>
            {/each}
          </div>
        {:else}
          <EmptyState
            icon={scope === 'announces' ? 'network' : 'bookmark'}
            title={$t(scope === 'announces' ? 'nomadnet.empty.announces.title' : 'nomadnet.empty.bookmarks.title')}
            body={$t(scope === 'announces' ? 'nomadnet.empty.announces.body' : 'nomadnet.empty.bookmarks.body')}
            hint={scope === 'announces' ? $t('nomadnet.offlineHint') : undefined}
          />
        {/if}
      </div>
    </aside>

    <section class:page-loaded={Boolean(loadedPage) && !loadingPage && !pageError} class="nomad-canvas" aria-busy={loadingPage}>
      <div class="nomad-grid" aria-hidden="true"></div>
      {#if loadingPage}
        <EmptyState
          icon="nomadnet"
          title={$t('nomadnet.page.loading')}
          body={loadingBody()}
          hint={loadingHint()}
        />
      {:else if pageError}
        <div class="nomad-page-error">
          <EmptyState
            icon="nomadnet"
            title={$t(pageError === 'link' ? 'nomadnet.page.linkError.title' : 'nomadnet.page.error.title')}
            body={$t(pageError === 'link' ? 'nomadnet.page.linkError.body' : pageLoadErrorMessage(pageErrorCode))}
            hint={pageError === 'load'
              ? pageErrorCode
                ? $t('nomadnet.page.error.code', { code: pageErrorCode })
                : $t('nomadnet.page.error.hint')
              : undefined}
          />
          {#if pageError === 'load' && failedPageRequest}
            <button class="button secondary" onclick={retryPage}>{$t('common.retry')}</button>
          {/if}
        </div>
      {:else if loadedPage}
        <MicronPage markup={loadedPage.content} onlink={openPageLink} />
      {:else}
        <EmptyState
          icon="nomadnet"
          title={$t('nomadnet.empty.title')}
          body={$t('nomadnet.empty.body')}
          hint={$t('nomadnet.offlineHint')}
        />
      {/if}
    </section>
  </div>
</div>

{#if bookmarkEditor}
  <NomadBookmarkEditor
    address={bookmarkEditor.address}
    currentName={bookmarkEditor.currentName}
    currentIdentifyBeforeLoad={bookmarkEditor.currentIdentifyBeforeLoad}
    mode={bookmarkEditor.bookmarkId ? 'edit' : 'add'}
    oncancel={() => { bookmarkEditor = undefined; }}
    onsave={saveBookmark}
  />
{/if}

{#if identityShareConfirmationOpen}
  <ConfirmationDialog
    titleId="nomad-identity-share-title"
    title={$t('nomadnet.page.identityShareDialog.title')}
    description={$t('nomadnet.page.identityShareDialog.description')}
    icon="fingerprint"
    confirmLabel={$t('nomadnet.page.identityShareDialog.confirm')}
    oncancel={() => { identityShareConfirmationOpen = false; }}
    onconfirm={confirmIdentityShare}
  />
{/if}

{#if destinationActions}
  <ContextMenu
    x={destinationActions.x}
    y={destinationActions.y}
    autofocus={destinationActions.autofocus}
    guardOpeningRelease={destinationActions.guardOpeningRelease}
    label={$t('nomadnet.destination.actions.label')}
    closeLabel={$t('nomadnet.destination.actions.close')}
    onclose={closeDestinationActions}
  >
    <button
      role="menuitem"
      onclick={() => { void copyDestinationHash(destinationActions!.destinationHash); }}
    >
      <Icon name="copy" size={17} />{$t('nomadnet.destination.actions.copyHash')}
    </button>
    {#if destinationActionBookmark}
      <button
        role="menuitem"
        onclick={() => {
          const bookmark = destinationActionBookmark;
          closeDestinationActions();
          if (bookmark) editBookmark(bookmark);
        }}
      >
        <Icon name="edit" size={17} />{$t('nomadnet.destination.actions.editBookmark')}
      </button>
      <button
        class="danger"
        role="menuitem"
        onclick={() => {
          const bookmarkId = destinationActionBookmark?.id;
          closeDestinationActions();
          if (bookmarkId) void removeBookmark(bookmarkId);
        }}
      >
        <Icon name="trash" size={17} />{$t('nomadnet.destination.actions.removeBookmark')}
      </button>
    {:else}
      <button
        role="menuitem"
        disabled={!$activeIdentity}
        onclick={addDestinationBookmark}
      >
        <Icon name="bookmark" size={17} />{$t('nomadnet.destination.actions.addBookmark')}
      </button>
    {/if}
  </ContextMenu>
{/if}
