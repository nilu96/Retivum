<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';
  import { slide } from 'svelte/transition';
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
  import { destinationsByFullName } from '../../domain/known-destination';
  import {
    activeIdentity,
    destinationPathStatuses,
    interfaceStatuses,
    knownDestinations,
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
  type NomadDirectoryScope = 'announces' | 'bookmarks';
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

  let { active = true }: { active?: boolean } = $props();
  let address = $state('');
  let selectedScope = $state<NomadDirectoryScope>();
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
  const mobileToolbarTransitionDurationMs = 220;
  const mobileToolbarViewportPreservationClass = 'nomad-toolbar-preserving-viewport';
  let bookmarkTogglePending = $state(false);
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
  let mobileViewport = $state(
    typeof window !== 'undefined'
      && window.matchMedia?.('(max-width: 699px)').matches === true,
  );
  let mobileBrowserElement = $state<HTMLElement>();
  let mobileToolbarStuck = $state(false);
  let mobileToolbarAtStickyEdge = $state(false);
  let mobileToolbarScrollTakeoverActive = $state(false);
  let mobileToolbarDocumentLockY: number | undefined;
  let mobileToolbarStickyBoundaryY: number | undefined;
  let mobileToolbarViewportAnchorTop: number | undefined;
  let mobileToolbarViewportOffset = 0;
  let preservingMobileToolbarViewport = false;
  let mobileToolbarViewportTimer: number | undefined;
  let mobileToolbarViewportAnimationFrame: number | undefined;
  let mobilePanelElement = $state<HTMLElement>();
  let mobilePanelScrollable = $state(false);
  let mobileCanvasElement = $state<HTMLElement>();
  let reducedMotion = $state(
    typeof window !== 'undefined'
      && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true,
  );

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
  const nomadDestinations = $derived(destinationsByFullName(
    $knownDestinations,
    'nomadnetwork.node',
  ));
  const filteredAnnounces = $derived(
    nomadDestinations.filter((item) => (
      item.lastAnnouncedAt
      && [item.displayName, item.destinationHash].some(
        (value) => value?.toLowerCase().includes(normalizedQuery),
      )
    )),
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
  const scope = $derived<NomadDirectoryScope>(
    selectedScope ?? ($nomadBookmarks.length ? 'bookmarks' : 'announces'),
  );
  const visibleDestinationCount = $derived(
    scope === 'announces' ? filteredAnnounces.length : filteredBookmarks.length,
  );
  const heardAtFormatter = $derived(createDateFormatter($locale));
  const destinationActionBookmark = $derived(destinationActions?.bookmarkId
    ? $nomadBookmarks.find((bookmark) => bookmark.id === destinationActions?.bookmarkId)
    : undefined);
  const interfaceRequiredHint = $derived(
    Object.values($interfaceStatuses).some((state) => state === 'online')
      ? undefined
      : $t('nomadnet.offlineHint'),
  );

  onMount(() => {
    const mobileQuery = window.matchMedia?.('(max-width: 699px)');
    const motionQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const updateMobileViewport = (): void => {
      mobileViewport = mobileQuery?.matches === true;
    };
    const updateMotionPreference = (): void => {
      reducedMotion = motionQuery?.matches === true;
    };
    updateMobileViewport();
    updateMotionPreference();
    mobileQuery?.addEventListener('change', updateMobileViewport);
    motionQuery?.addEventListener('change', updateMotionPreference);
    window.addEventListener('scroll', updateMobileToolbarStuck, { passive: true, capture: true });
    window.addEventListener('resize', updateMobileToolbarStuck, { passive: true });
    document.addEventListener('click', handleViewOutsideClick, { capture: true });
    window.visualViewport?.addEventListener('resize', updateMobileToolbarStuck);
    window.visualViewport?.addEventListener('scroll', updateMobileToolbarStuck);
    return () => {
      if (mobileToolbarViewportTimer !== undefined) {
        window.clearTimeout(mobileToolbarViewportTimer);
      }
      if (mobileToolbarViewportAnimationFrame !== undefined) {
        window.cancelAnimationFrame(mobileToolbarViewportAnimationFrame);
      }
      mobileCanvasElement?.classList.remove('nomad-toolbar-viewport-anchor');
      mobileCanvasElement?.style.removeProperty('--nomad-toolbar-viewport-offset');
      document.documentElement.classList.remove(mobileToolbarViewportPreservationClass);
      mobileQuery?.removeEventListener('change', updateMobileViewport);
      motionQuery?.removeEventListener('change', updateMotionPreference);
      window.removeEventListener('scroll', updateMobileToolbarStuck, true);
      window.removeEventListener('resize', updateMobileToolbarStuck);
      document.removeEventListener('click', handleViewOutsideClick, true);
      window.visualViewport?.removeEventListener('resize', updateMobileToolbarStuck);
      window.visualViewport?.removeEventListener('scroll', updateMobileToolbarStuck);
    };
  });

  $effect(() => {
    mobileViewport;
    directoryExpanded;
    active;
    void tick().then(updateMobileToolbarStuck);
  });

  $effect(() => {
    const browser = mobileBrowserElement;
    if (!browser) return;
    if (typeof ResizeObserver === 'undefined') return;
    const resizeObserver = new ResizeObserver(() => {
      preserveMobileToolbarViewport();
    });
    resizeObserver.observe(browser);
    return () => {
      resizeObserver.disconnect();
    };
  });

  $effect(() => {
    const panel = mobilePanelElement;
    if (!panel) {
      mobilePanelScrollable = false;
      return;
    }
    updateMobilePanelScrollability();
    const resizeObserver = typeof ResizeObserver === 'undefined'
      ? undefined
      : new ResizeObserver(updateMobilePanelScrollability);
    const mutationObserver = typeof MutationObserver === 'undefined'
      ? undefined
      : new MutationObserver(updateMobilePanelScrollability);
    resizeObserver?.observe(panel);
    mutationObserver?.observe(panel, { childList: true, subtree: true, characterData: true });
    return () => {
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
    };
  });

  const scopes: Array<{ id: NomadDirectoryScope; label: MessageKey; searchName: MessageKey }> = [
    { id: 'bookmarks', label: 'nomadnet.scope.bookmarks', searchName: 'nomadnet.scope.bookmarks.searchName' },
    { id: 'announces', label: 'nomadnet.scope.announces', searchName: 'nomadnet.scope.announces.searchName' },
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

  function toggleDirectory(): void {
    setDirectoryExpanded(!directoryExpanded);
  }

  function setDirectoryExpanded(expanded: boolean): void {
    if (directoryExpanded === expanded) return;
    beginMobileToolbarViewportPreservation();
    if (!expanded && mobileToolbarStuck) {
      mobileToolbarAtStickyEdge = window.scrollY
        <= (mobileToolbarStickyBoundaryY ?? window.scrollY) + 1;
    }
    directoryExpanded = expanded;
    if (expanded && mobileToolbarStuck) {
      mobileToolbarDocumentLockY = window.scrollY;
    }
  }

  function resetPageViewport(): void {
    if (mobileToolbarViewportTimer !== undefined) {
      window.clearTimeout(mobileToolbarViewportTimer);
      mobileToolbarViewportTimer = undefined;
    }
    if (mobileToolbarViewportAnimationFrame !== undefined) {
      window.cancelAnimationFrame(mobileToolbarViewportAnimationFrame);
      mobileToolbarViewportAnimationFrame = undefined;
    }
    preservingMobileToolbarViewport = false;
    mobileToolbarViewportAnchorTop = undefined;
    mobileToolbarViewportOffset = 0;
    mobileCanvasElement?.classList.remove('nomad-toolbar-viewport-anchor');
    mobileCanvasElement?.style.removeProperty('--nomad-toolbar-viewport-offset');
    document.documentElement.classList.remove(mobileToolbarViewportPreservationClass);
    directoryExpanded = false;
    if (mobilePanelElement) mobilePanelElement.scrollTop = 0;
    mobileToolbarStuck = false;
    mobileToolbarAtStickyEdge = false;
    mobileToolbarScrollTakeoverActive = false;
    mobileToolbarDocumentLockY = undefined;
    mobileToolbarStickyBoundaryY = undefined;
    if (mobileViewport) window.scrollTo(0, 0);
  }

  function selectDirectoryScope(nextScope: NomadDirectoryScope): void {
    if (scope !== nextScope || query) {
      beginMobileToolbarViewportPreservation();
    }
    selectedScope = nextScope;
    query = '';
  }

  function beginMobileToolbarViewportPreservation(): void {
    if (!mobileViewport || !mobileToolbarStuck || !mobileBrowserElement) return;
    if (mobileToolbarViewportAnimationFrame !== undefined) {
      window.cancelAnimationFrame(mobileToolbarViewportAnimationFrame);
      mobileToolbarViewportAnimationFrame = undefined;
    }
    if (!preservingMobileToolbarViewport) {
      preservingMobileToolbarViewport = true;
      document.documentElement.classList.add(mobileToolbarViewportPreservationClass);
      mobileToolbarViewportAnchorTop = mobileCanvasElement?.getBoundingClientRect().top;
      mobileToolbarViewportOffset = 0;
      mobileCanvasElement?.classList.add('nomad-toolbar-viewport-anchor');
      mobileCanvasElement?.style.setProperty('--nomad-toolbar-viewport-offset', '0px');
    }
    if (mobileToolbarViewportTimer !== undefined) {
      window.clearTimeout(mobileToolbarViewportTimer);
    }
    mobileToolbarViewportTimer = window.setTimeout(() => {
      finishMobileToolbarViewportPreservation();
    }, reducedMotion ? 50 : mobileToolbarTransitionDurationMs + 80);
  }

  function preserveMobileToolbarViewport(): void {
    if (
      !preservingMobileToolbarViewport
      || !mobileToolbarStuck
      || mobileToolbarViewportAnchorTop === undefined
      || !mobileCanvasElement
    ) return;
    const layoutTop = mobileCanvasElement.getBoundingClientRect().top
      - mobileToolbarViewportOffset;
    const desiredViewportOffset = mobileToolbarViewportAnchorTop - layoutTop;
    const availableUpwardScroll = mobileToolbarStuck
      ? Math.max(0, window.scrollY - (mobileToolbarStickyBoundaryY ?? 0))
      : Number.POSITIVE_INFINITY;
    mobileToolbarViewportOffset = desiredViewportOffset > 0
      ? Math.min(desiredViewportOffset, availableUpwardScroll)
      : desiredViewportOffset;
    mobileCanvasElement.style.setProperty(
      '--nomad-toolbar-viewport-offset',
      `${mobileToolbarViewportOffset}px`,
    );
  }

  function finishMobileToolbarViewportPreservation(): void {
    preserveMobileToolbarViewport();
    const canvas = mobileCanvasElement;
    const anchorTop = mobileToolbarViewportAnchorTop;
    const currentScrollY = window.scrollY;
    const minimumScrollY = mobileToolbarStuck
      ? (mobileToolbarStickyBoundaryY ?? 0)
      : 0;
    const targetScrollY = Math.max(
      minimumScrollY,
      currentScrollY - mobileToolbarViewportOffset,
    );
    const intendedScrollDelta = targetScrollY - currentScrollY;
    canvas?.classList.remove('nomad-toolbar-viewport-anchor');
    canvas?.style.removeProperty('--nomad-toolbar-viewport-offset');
    window.scrollTo(window.scrollX, targetScrollY);
    if (canvas && anchorTop !== undefined) {
      const residual = canvas.getBoundingClientRect().top - anchorTop;
      if (residual !== 0) {
        window.scrollTo(window.scrollX, Math.max(minimumScrollY, targetScrollY + residual));
      }
    }
    mobileToolbarDocumentLockY = (mobileToolbarDocumentLockY ?? currentScrollY)
      + intendedScrollDelta;
    preservingMobileToolbarViewport = false;
    mobileToolbarViewportAnchorTop = undefined;
    mobileToolbarViewportOffset = 0;
    mobileToolbarViewportTimer = undefined;
    mobileToolbarViewportAnimationFrame = window.requestAnimationFrame(() => {
      document.documentElement.classList.remove(mobileToolbarViewportPreservationClass);
      mobileToolbarViewportAnimationFrame = undefined;
    });
  }

  function updateMobileToolbarStuck(): void {
    if (!mobileViewport || !active || !mobileBrowserElement) {
      mobileToolbarStuck = false;
      mobileToolbarAtStickyEdge = false;
      mobileToolbarScrollTakeoverActive = false;
      mobileToolbarDocumentLockY = undefined;
      mobileToolbarStickyBoundaryY = undefined;
      return;
    }
    // Mobile overlays lock the body with fixed positioning. Ignore the
    // resulting synthetic geometry changes so they cannot reset the sticky
    // boundary and make an already-stuck toolbar look newly stuck.
    if (document.documentElement.classList.contains('overlay-open')) return;
    const stickyTop = Number.parseFloat(getComputedStyle(mobileBrowserElement).top);
    const resolvedStickyTop = Number.isFinite(stickyTop) ? stickyTop : 0;
    const toolbarTop = mobileBrowserElement.getBoundingClientRect().top;
    const stuck = window.scrollY > 0 && toolbarTop <= resolvedStickyTop + 1;
    if (!stuck) {
      mobileToolbarStuck = false;
      mobileToolbarAtStickyEdge = false;
      mobileToolbarScrollTakeoverActive = false;
      mobileToolbarDocumentLockY = window.scrollY + Math.max(0, toolbarTop - resolvedStickyTop);
      mobileToolbarStickyBoundaryY = undefined;
      return;
    }

    const enteringStickyState = !mobileToolbarStuck;
    mobileToolbarStuck = true;
    if (mobileToolbarDocumentLockY === undefined) {
      mobileToolbarDocumentLockY = window.scrollY;
    }
    if (enteringStickyState) {
      mobileToolbarAtStickyEdge = true;
      mobileToolbarStickyBoundaryY = mobileToolbarDocumentLockY;
      mobileToolbarScrollTakeoverActive = directoryExpanded && mobilePanelScrollable;
    } else {
      mobileToolbarAtStickyEdge = window.scrollY
        <= (mobileToolbarStickyBoundaryY ?? window.scrollY) + 1;
    }
    if (
      !mobileToolbarScrollTakeoverActive
      || !directoryExpanded
      || !mobilePanelScrollable
      || window.scrollY <= mobileToolbarDocumentLockY
    ) {
      return;
    }

    const transferredDistance = window.scrollY - mobileToolbarDocumentLockY;
    if (mobilePanelElement) {
      mobilePanelElement.scrollTop += transferredDistance;
    }
    window.scrollTo(window.scrollX, mobileToolbarDocumentLockY);
  }

  function updateMobilePanelScrollability(): void {
    const panel = mobilePanelElement;
    if (!directoryExpanded || !panel) {
      mobilePanelScrollable = false;
      return;
    }
    const scrollable = panel.scrollHeight > panel.clientHeight + 1;
    const wasScrollable = untrack(() => mobilePanelScrollable);
    if (scrollable && !wasScrollable && mobileToolbarStuck) {
      mobileToolbarDocumentLockY = window.scrollY;
      mobileToolbarScrollTakeoverActive = true;
    }
    mobilePanelScrollable = scrollable;
  }

  function handleViewKeydown(event: KeyboardEvent): void {
    if (!active || !mobileViewport || !directoryExpanded || event.key !== 'Escape') return;
    event.preventDefault();
    setDirectoryExpanded(false);
  }

  function hasForegroundDialog(): boolean {
    return document.querySelector(
      '[role="dialog"][aria-modal="true"], [role="alertdialog"][aria-modal="true"]',
    ) !== null;
  }

  function handleViewOutsideClick(event: MouseEvent): void {
    if (
      !active
      || !mobileViewport
      || !directoryExpanded
      || hasForegroundDialog()
    ) return;
    const toolbar = mobileBrowserElement;
    if (!toolbar || event.composedPath().includes(toolbar)) return;
    setDirectoryExpanded(false);
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
    resetPageViewport();
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
        resetPageViewport();
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
      resetPageViewport();
      loadedPage = { ...nextPage, requestData: nextRequestData, identifyBeforeLoad };
      address = formatNomadAddress(nextPage.destinationHash, nextPage.path, nextRequestData);
      return true;
    } catch {
      if (sequence === navigationSequence) {
        resetPageViewport();
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
    setDirectoryExpanded(false);
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
      setDirectoryExpanded(false);
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
      resetPageViewport();
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
      resetPageViewport();
      failedPageRequest = undefined;
      pageError = undefined;
      pageErrorCode = undefined;
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
    resetPageViewport();
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
    resetPageViewport();
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
    if (bytes < 1_000) return `${bytes} B`;
    if (bytes < 1_000_000) return `${Math.round(bytes / 1_000)} KB`;
    return `${(bytes / 1_000_000).toFixed(1)} MB`;
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

  async function toggleCurrentBookmark(): Promise<void> {
    const targetAddress = parsedAddress;
    const targetBookmark = currentBookmark;
    if (!targetAddress || bookmarkTogglePending) return;
    if (!targetBookmark && !$activeIdentity) return;
    let stopWatchingBookmarkChanges: (() => void) | undefined;
    if (mobileViewport && directoryExpanded && mobileToolbarStuck) {
      beginMobileToolbarViewportPreservation();
      let initialNotification = true;
      stopWatchingBookmarkChanges = nomadBookmarks.subscribe(() => {
        if (initialNotification) {
          initialNotification = false;
          return;
        }
        // Store subscribers run before Svelte updates the destination list,
        // so this captures the old canvas position even after a slow write.
        beginMobileToolbarViewportPreservation();
      });
    }
    bookmarkTogglePending = true;
    try {
      if (targetBookmark) {
        await reticulumRuntime.deleteNomadBookmark(targetBookmark.id);
        return;
      }
      const addressToBookmark = formatNomadAddress(
        targetAddress.destinationHash,
        targetAddress.path,
        targetAddress.requestData,
      );
      const suggestedName = $knownDestinations.find((destination) => (
        destination.destinationHash === targetAddress.destinationHash
      ))?.displayName ?? '';
      if (!await reticulumRuntime.addNomadBookmark(addressToBookmark, suggestedName, false)) {
        toast.error('nomadnet.bookmark.saveError');
      }
    } catch {
      toast.error('nomadnet.directory.error');
    } finally {
      stopWatchingBookmarkChanges?.();
      if (stopWatchingBookmarkChanges) beginMobileToolbarViewportPreservation();
      bookmarkTogglePending = false;
    }
  }

  function editBookmark(bookmark: NomadBookmark): void {
    bookmarkEditor = {
      address: formatNomadAddress(bookmark.destinationHash, bookmark.path, bookmark.requestData ?? {}),
      currentName: bookmark.label ?? '',
      currentIdentifyBeforeLoad: bookmark.identifyBeforeLoad === true,
      bookmarkId: bookmark.id,
    };
  }

  function closeBookmarkEditor(): void {
    bookmarkEditor = undefined;
    if (!mobileViewport) return;
    void tick().then(() => {
      window.requestAnimationFrame(updateMobileToolbarStuck);
    });
  }

  async function saveBookmark(
    address: string,
    name: string,
    identifyBeforeLoad: boolean,
  ): Promise<boolean> {
    if (!bookmarkEditor) return false;
    return bookmarkEditor.bookmarkId
      ? await reticulumRuntime.updateNomadBookmark(
          bookmarkEditor.bookmarkId,
          address,
          name,
          identifyBeforeLoad,
        )
      : await reticulumRuntime.addNomadBookmark(address, name, identifyBeforeLoad);
  }

  async function removeBookmark(id: string): Promise<void> {
    try {
      await reticulumRuntime.deleteNomadBookmark(id);
    } catch {
      toast.error('nomadnet.directory.error');
    }
  }
</script>

<svelte:window onkeydown={handleViewKeydown} />

<div class="page nomad-page">
  <header class="page-header nomad-header">
    <div>
      <p class="eyebrow">{$t('app.name')}</p>
      <h1>{$t('nomadnet.title')}</h1>
      <p>{$t('nomadnet.subtitle')}</p>
    </div>
    {#if !mobileViewport}
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
          class="icon-button nomad-bookmark-button"
          class:bookmarked={Boolean(currentBookmark)}
          aria-label={$t(currentBookmark ? 'nomadnet.removeCurrentBookmark' : 'nomadnet.bookmarkCurrent')}
          title={$t(currentBookmark ? 'nomadnet.removeCurrentBookmark' : 'nomadnet.bookmarkCurrent')}
          disabled={bookmarkTogglePending || !parsedAddress || (!currentBookmark && !$activeIdentity)}
          onclick={toggleCurrentBookmark}
        ><Icon name={currentBookmark ? 'bookmark-filled' : 'bookmark'} size={19} /></button>
      </div>
    {/if}
  </header>

  <div
    class="nomad-mobile-browser"
    class:expanded={directoryExpanded}
    class:stuck={mobileToolbarStuck}
    class:at-sticky-edge={mobileToolbarAtStickyEdge}
    class:scroll-takeover={mobileToolbarScrollTakeoverActive}
    bind:this={mobileBrowserElement}
  >
    {#if mobileViewport}
      <nav class="nomad-mobile-toolbar" aria-label={$t('nomadnet.page.actions.label')}>
        <button
          class="icon-button nomad-back-button"
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
        <button
          class="icon-button"
          type="button"
          aria-label={$t('nomadnet.page.reload')}
          title={$t('nomadnet.page.reload')}
          disabled={!loadedPage && !pendingPageRequest && !failedPageRequest}
          onclick={reloadPage}
        ><Icon name="sync" size={19} /></button>
        <button
          class="icon-button"
          type="button"
          aria-label={$t(sharingIdentity ? 'nomadnet.page.sharingIdentity' : 'nomadnet.page.shareIdentity')}
          title={$t(sharingIdentity ? 'nomadnet.page.sharingIdentity' : 'nomadnet.page.shareIdentity')}
          disabled={!loadedPage || loadingPage || sharingIdentity}
          onclick={() => { identityShareConfirmationOpen = true; }}
        ><Icon name="fingerprint" size={19} /></button>
        <button
          class="icon-button nomad-bookmark-button"
          class:bookmarked={Boolean(currentBookmark)}
          type="button"
          aria-label={$t(currentBookmark ? 'nomadnet.removeCurrentBookmark' : 'nomadnet.bookmarkCurrent')}
          title={$t(currentBookmark ? 'nomadnet.removeCurrentBookmark' : 'nomadnet.bookmarkCurrent')}
          disabled={bookmarkTogglePending || !parsedAddress || (!currentBookmark && !$activeIdentity)}
          onclick={toggleCurrentBookmark}
        ><Icon name={currentBookmark ? 'bookmark-filled' : 'bookmark'} size={19} /></button>
        <button
          class="icon-button nomad-panel-toggle"
          type="button"
          aria-controls="nomad-mobile-panel"
          aria-expanded={directoryExpanded}
          aria-label={$t(directoryExpanded ? 'nomadnet.directory.hide' : 'nomadnet.directory.show', {
            count: visibleDestinationCount,
            scope: $t(scope === 'announces'
              ? 'nomadnet.scope.announces.searchName'
              : 'nomadnet.scope.bookmarks.searchName'),
          })}
          title={$t(directoryExpanded ? 'nomadnet.directory.hide' : 'nomadnet.directory.show', {
            count: visibleDestinationCount,
            scope: $t(scope === 'announces'
              ? 'nomadnet.scope.announces.searchName'
              : 'nomadnet.scope.bookmarks.searchName'),
          })}
          onclick={toggleDirectory}
        ><Icon name="chevron-down" size={19} /></button>
      </nav>
    {/if}

    {#if !mobileViewport || directoryExpanded}
    <div
      id="nomad-mobile-panel"
      class="nomad-browser-panel"
      class:scrollable={mobilePanelScrollable}
      bind:this={mobilePanelElement}
      transition:slide={{ axis: 'y', duration: reducedMotion ? 0 : mobileToolbarTransitionDurationMs }}
    >
      <div class="nomad-browser-panel-content">
      <form class="nomad-address" onsubmit={submitAddress}>
        {#if !mobileViewport}
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
        {/if}
        <label>
          <span class="sr-only">{$t('nomadnet.address.label')}</span>
          <Icon name="nomadnet" size={19} />
          <input bind:value={address} placeholder={$t('nomadnet.address.placeholder')} autocapitalize="none" spellcheck="false" />
        </label>
        <button
          class="button primary nomad-open-button"
          type="submit"
          aria-label={$t(loadingPage ? 'nomadnet.page.loading.short' : 'nomadnet.go')}
          title={$t(loadingPage ? 'nomadnet.page.loading.short' : 'nomadnet.go')}
          disabled={!parsedAddress || loadingPage}
        >
          <span>{$t(loadingPage ? 'nomadnet.page.loading.short' : 'nomadnet.go')}</span>
          <Icon name="arrow-right" size={17} />
        </button>
      </form>

      <aside class:expanded={directoryExpanded} class="nomad-directory">
        <div class="scope-tabs" role="tablist" aria-label={$t('nomadnet.scopes.label')}>
          {#each scopes as item}
            <button
              role="tab"
              aria-selected={scope === item.id}
              class:active={scope === item.id}
              onclick={() => { selectDirectoryScope(item.id); }}
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
            onfocus={() => { setDirectoryExpanded(true); }}
          />
        </label>
        <div id="nomad-destination-results" class="nomad-directory-content" role="tabpanel">
        {#if scope === 'announces' && filteredAnnounces.length}
          <div class="nomad-destination-list">
            {#each filteredAnnounces as announce (announce.destinationHash)}
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
                  <small>{$t('nomadnet.announce.heardAt', {
                    date: heardAtFormatter.format(new Date(announce.lastAnnouncedAt!)),
                  })}</small>
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
            hint={scope === 'announces' ? interfaceRequiredHint : undefined}
          />
        {/if}
      </div>
    </aside>
    </div>
    </div>
    {/if}
  </div>

  <section
    class:page-loaded={Boolean(loadedPage) && !loadingPage && !pageError}
    class="nomad-canvas"
    aria-busy={loadingPage}
    bind:this={mobileCanvasElement}
  >
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
          hint={interfaceRequiredHint}
        />
      {/if}
  </section>
</div>

{#if bookmarkEditor}
  <NomadBookmarkEditor
    address={bookmarkEditor.address}
    currentName={bookmarkEditor.currentName}
    currentIdentifyBeforeLoad={bookmarkEditor.currentIdentifyBeforeLoad}
    mode={bookmarkEditor.bookmarkId ? 'edit' : 'add'}
    oncancel={closeBookmarkEditor}
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
