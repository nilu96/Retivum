<script lang="ts">
  import { createDateFormatter, locale, t, type MessageKey } from '../../i18n';
  import {
    NOMAD_DEFAULT_PAGE_PATH,
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
  import Icon from '../../lib/components/Icon.svelte';
  import PathStatus from '../../lib/components/PathStatus.svelte';
  import MicronPage from './MicronPage.svelte';
  import NomadBookmarkEditor from './NomadBookmarkEditor.svelte';
  import { toast } from '../../lib/notifications/toasts';

  let address = $state('');
  let scope = $state<'announces' | 'bookmarks'>('announces');
  let query = $state('');
  let directoryExpanded = $state(true);
  let loadedPage = $state<NomadPage>();
  let loadingPage = $state(false);
  let pendingPageRequest = $state<{
    destinationHash: string;
    path: string;
    requestData: NomadRequestData;
  }>();
  let sharingIdentity = $state(false);
  let pageError = $state<'load' | 'link'>();
  let pageErrorCode = $state<string>();
  let loadingStage = $state<NomadPageLoadStage | 'preparing'>('preparing');
  let loadingProgress = $state<number>();
  let loadingDataSize = $state<number>();
  let navigationHistory = $state<NomadPage[]>([]);
  let navigationSequence = 0;
  const maximumNavigationHistoryEntries = 32;
  const identityReloadDelayMs = 500;
  let bookmarkEditor = $state<{
    address: string;
    currentName: string;
    bookmarkId?: string;
  }>();

  const parsedAddress = $derived(parseNomadAddress(address));
  const canGoHome = $derived(Boolean(
    (pendingPageRequest ?? loadedPage)
      && nomadRequestPath((pendingPageRequest ?? loadedPage)?.path ?? '/') !== NOMAD_DEFAULT_PAGE_PATH,
  ));
  const currentBookmark = $derived(parsedAddress
    ? $nomadBookmarks.find((item) =>
      item.destinationHash === parsedAddress.destinationHash
        && nomadRequestPath(item.path) === nomadRequestPath(parsedAddress.path),
    )
    : undefined);
  const normalizedQuery = $derived(query.trim().toLowerCase());
  const filteredAnnounces = $derived(
    $nomadAnnounces.filter((item) => item.destinationHash.includes(normalizedQuery)),
  );
  const filteredBookmarks = $derived(
    $nomadBookmarks.filter((item) =>
      [item.label, item.destinationHash, item.path].some((value) => value?.toLowerCase().includes(normalizedQuery)),
    ),
  );
  const visibleDestinationCount = $derived(
    scope === 'announces' ? filteredAnnounces.length : filteredBookmarks.length,
  );
  const heardAtFormatter = $derived(createDateFormatter($locale));

  const scopes: Array<{ id: 'announces' | 'bookmarks'; label: MessageKey; searchName: MessageKey }> = [
    { id: 'announces', label: 'nomadnet.scope.announces', searchName: 'nomadnet.scope.announces.searchName' },
    { id: 'bookmarks', label: 'nomadnet.scope.bookmarks', searchName: 'nomadnet.scope.bookmarks.searchName' },
  ];

  async function openDestination(
    destinationHash: string,
    path = '/',
    mode: 'push' | 'replace' = 'push',
    requestData: NomadRequestData = {},
    freshLink = false,
  ): Promise<boolean> {
    const requestPath = nomadRequestPath(path);
    // Values read back from Svelte state can be proxies, which cannot be sent
    // through Worker.postMessage. Keep the runtime boundary cloneable.
    const plainRequestData = { ...requestData };
    address = nomadAddress(destinationHash, requestPath, plainRequestData);
    const previousPage = loadedPage;
    const sequence = ++navigationSequence;
    pendingPageRequest = { destinationHash, path: requestPath, requestData: plainRequestData };
    loadingPage = true;
    loadingStage = 'preparing';
    loadingProgress = undefined;
    loadingDataSize = undefined;
    pageError = undefined;
    pageErrorCode = undefined;
    try {
      const onUpdate = (update: NomadPageLoadUpdate) => handlePageLoadUpdate(sequence, update);
      const nextPage = freshLink
        ? await reticulumRuntime.requestNomadPage(
            destinationHash,
            requestPath,
            plainRequestData,
            onUpdate,
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
      loadedPage = { ...nextPage, requestData: nextRequestData };
      address = nomadAddress(nextPage.destinationHash, nomadRequestPath(nextPage.path), nextRequestData);
      return true;
    } catch {
      if (sequence === navigationSequence) {
        pageError = 'load';
        pageErrorCode = 'NOMAD_REQUEST_FAILED';
      }
      return false;
    } finally {
      if (sequence === navigationSequence) {
        loadingPage = false;
        pendingPageRequest = undefined;
      }
    }
  }

  function openDirectoryDestination(destinationHash: string, path = '/'): void {
    directoryExpanded = false;
    void openDestination(destinationHash, path);
  }

  function submitAddress(event: SubmitEvent): void {
    event.preventDefault();
    if (parsedAddress) void openDestination(parsedAddress.destinationHash, parsedAddress.path, 'push', parsedAddress.requestData);
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
    });
  }

  function retryPage(): void {
    if (parsedAddress) void openDestination(parsedAddress.destinationHash, parsedAddress.path, 'push', parsedAddress.requestData);
  }

  function reloadPage(): void {
    const target = pendingPageRequest ?? (loadedPage ? {
      destinationHash: loadedPage.destinationHash,
      path: loadedPage.path,
      requestData: loadedPage.requestData,
    } : undefined);
    if (!target) return;
    void openDestination(
      target.destinationHash,
      target.path,
      'replace',
      target.requestData,
      true,
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

  function goBack(): void {
    if (cancelPendingLoadAndRestorePage()) return;
    const previous = navigationHistory.at(-1);
    if (!previous) return;
    navigationSequence += 1;
    navigationHistory = navigationHistory.slice(0, -1);
    pendingPageRequest = undefined;
    loadingPage = false;
    pageError = undefined;
    pageErrorCode = undefined;
    directoryExpanded = false;
    loadedPage = {
      ...previous,
      requestData: { ...(previous.requestData ?? {}) },
    };
    address = nomadAddress(previous.destinationHash, nomadRequestPath(previous.path), previous.requestData ?? {});
  }

  function cancelPendingLoadAndRestorePage(): boolean {
    if (!loadingPage || !pendingPageRequest || !loadedPage) return false;
    reticulumRuntime.cancelNomadPage(pendingPageRequest.destinationHash);
    navigationSequence += 1;
    pendingPageRequest = undefined;
    loadingPage = false;
    pageError = undefined;
    pageErrorCode = undefined;
    directoryExpanded = false;
    address = nomadAddress(
      loadedPage.destinationHash,
      nomadRequestPath(loadedPage.path),
      loadedPage.requestData ?? {},
    );
    return true;
  }

  function nomadAddress(destinationHash: string, path: string, requestData: NomadRequestData): string {
    const variables = Object.entries(requestData)
      .filter(([key]) => key.startsWith('var_'))
      .map(([key, value]) => `${key.slice(4)}=${value}`);
    return `${destinationHash}:${path}${variables.length ? `\`${variables.join('|')}` : ''}`;
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
    const target = pendingPageRequest ?? loadedPage;
    if (!target || !canGoHome) return;
    if (
      pendingPageRequest
      && loadedPage?.destinationHash === target.destinationHash
      && nomadRequestPath(loadedPage.path) === NOMAD_DEFAULT_PAGE_PATH
      && cancelPendingLoadAndRestorePage()
    ) return;
    if (pendingPageRequest) reticulumRuntime.cancelNomadPage(pendingPageRequest.destinationHash);
    void openDestination(target.destinationHash, NOMAD_DEFAULT_PAGE_PATH);
  }

  function bookmarkCurrent(): void {
    if (!parsedAddress || currentBookmark) return;
    const announcedName = $nomadAnnounces.find((item) => (
      item.destinationHash === parsedAddress.destinationHash
    ))?.displayName;
    bookmarkEditor = {
      address: `${parsedAddress.destinationHash}:${parsedAddress.path}`,
      currentName: announcedName ?? '',
    };
  }

  function editBookmark(bookmark: NomadBookmark): void {
    bookmarkEditor = {
      address: `${bookmark.destinationHash}:${bookmark.path}`,
      currentName: bookmark.label ?? '',
      bookmarkId: bookmark.id,
    };
  }

  async function saveBookmarkName(name: string): Promise<boolean> {
    if (!bookmarkEditor) return false;
    const saved = bookmarkEditor.bookmarkId
      ? await reticulumRuntime.updateNomadBookmarkName(bookmarkEditor.bookmarkId, name)
      : await reticulumRuntime.addNomadBookmark(bookmarkEditor.address, name);
    if (saved) scope = 'bookmarks';
    return saved;
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
        onclick={shareIdentity}
      ><Icon name="fingerprint" size={19} /></button>
      <button
        class="icon-button"
        aria-label={$t('nomadnet.page.reload')}
        title={$t('nomadnet.page.reload')}
        disabled={!loadedPage && !pendingPageRequest}
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
        disabled={loadingPage ? !loadedPage : !navigationHistory.length}
        onclick={goBack}
      ><Icon name="arrow-left" size={19} /></button>
      <button
        class="icon-button"
        type="button"
        aria-label={$t('nomadnet.page.home')}
        title={$t('nomadnet.page.home')}
        disabled={!canGoHome}
        onclick={goHome}
      ><Icon name="home" size={19} /></button>
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
              <button class="nomad-destination" onclick={() => openDirectoryDestination(announce.destinationHash)}>
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
              <div class="nomad-bookmark-row">
                <button class="nomad-destination" onclick={() => openDirectoryDestination(bookmark.destinationHash, bookmark.path)}>
                  <span class="destination-mark"><Icon name="bookmark" size={17} /></span>
                  <span>
                    {#if bookmark.label}<strong>{bookmark.label}</strong>{/if}
                    <code>{bookmark.destinationHash}</code>
                    <small>{bookmark.path}</small>
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
          {#if pageError === 'load' && parsedAddress}
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
    mode={bookmarkEditor.bookmarkId ? 'edit' : 'add'}
    oncancel={() => { bookmarkEditor = undefined; }}
    onsave={saveBookmarkName}
  />
{/if}
