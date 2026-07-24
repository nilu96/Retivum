<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { navigateBack } from '../../app/router';
  import { normalizeDestinationHash } from '../../domain/settings';
  import { createDateFormatter, locale, t } from '../../i18n';
  import type { KnownDestinationEntry } from '../../infrastructure/reticulum/protocol';
  import {
    chatAnnounces,
    chatContacts,
    destinationPathStatuses,
    knownDestinations,
    nomadAnnounces,
    pathTableEntries,
    propagationNodeAnnounces,
    provisioningNodes,
    reticulumRuntime,
    runtimeStatus,
    statusDetails,
  } from '../../infrastructure/reticulum/runtime';
  import { pendingProbeDestinationHashes } from '../../infrastructure/reticulum/probe-operations';
  import { probeTimeoutMsForPath } from '../../infrastructure/reticulum/timeouts';
  import type { ContextMenuOpenMethod } from '../../lib/actions/contextMenuTrigger';
  import { copyText } from '../../lib/clipboard';
  import ConfirmationDialog from '../../lib/components/ConfirmationDialog.svelte';
  import ContextMenu from '../../lib/components/ContextMenu.svelte';
  import EmptyState from '../../lib/components/EmptyState.svelte';
  import Icon from '../../lib/components/Icon.svelte';
  import { showDestinationProbeActivity } from '../../lib/notifications/probe-activity';
  import { liveActivity, toast } from '../../lib/notifications/toasts';
  import {
    groupKnownDestinationsByIdentity,
    knownDestinationPresentations,
    sortKnownDestinationsByLastAnnounce,
    type KnownDestinationApplication,
  } from './known-destinations';
  import PathManagementEntry from './PathManagementEntry.svelte';

  type ManagementTab = 'paths' | 'destinations';
  const destinationApplicationTypes: KnownDestinationApplication[] = [
    'lxmfDelivery',
    'lxmfPropagation',
    'nomadnet',
    'management',
    'probe',
    'unknown',
  ];
  const counterpartHighlightDurationMs = 2_000;
  type Confirmation =
    | { kind: 'forget'; destinationHash: string }
    | { kind: 'clearPaths' }
    | { kind: 'clearDestinations' };
  interface EntryActions {
    destinationHash: string;
    counterpartTab: ManagementTab;
    x: number;
    y: number;
    autofocus: boolean;
    guardOpeningRelease: boolean;
  }
  interface DisplayedKnownDestination {
    entry: KnownDestinationEntry;
    identityGroupStart: boolean;
    identityGroupCount: number;
    identityPublicKey?: string;
    identityGroupPosition?: 'first' | 'middle' | 'last';
    localSectionStart: boolean;
  }

  let page: HTMLDivElement;
  let activeTab = $state<ManagementTab>('paths');
  let destinationHash = $state('');
  let destinationFilter = $state('');
  let interfaceFilter = $state('');
  let hopFilter = $state<number | undefined>(undefined);
  let filtersExpanded = $state(false);
  let destinationTypeFilter = $state<KnownDestinationApplication | ''>('');
  let groupDestinationsByIdentity = $state(false);
  let validationVisible = $state(false);
  let busyOperations = $state<string[]>([]);
  let confirmation = $state<Confirmation>();
  let entryActions = $state<EntryActions>();
  let highlightedDestination = $state<string>();
  let scrollContainer: HTMLElement | undefined;
  let scrollToTopVisible = $state(false);
  let highlightTimer: ReturnType<typeof setTimeout> | undefined;
  const dateFormatter = $derived(createDateFormatter($locale));
  const numberFormatter = $derived(new Intl.NumberFormat($locale, { maximumFractionDigits: 1 }));
  const normalizedDestination = $derived(normalizeDestinationHash(destinationHash));
  const normalizedDestinationFilter = $derived(destinationFilter.trim().toLowerCase());
  const filteredPathEntries = $derived([...$pathTableEntries].filter((entry) => (
    (!normalizedDestinationFilter || entry.destinationHash.includes(normalizedDestinationFilter))
    && (!interfaceFilter || entry.interfaceId === interfaceFilter)
    && (hopFilter === undefined || entry.hops === hopFilter)
  )).sort((left, right) => (
    (right.lastAnnouncedAt ?? '').localeCompare(left.lastAnnouncedAt ?? '')
    || left.destinationHash.localeCompare(right.destinationHash)
  )));
  const presentationDestinations = $derived<KnownDestinationEntry[]>([
    ...$knownDestinations,
    ...$pathTableEntries
      .filter((path) => !$knownDestinations.some((entry) => entry.destinationHash === path.destinationHash))
      .map((path) => ({ destinationHash: path.destinationHash })),
  ]);
  const destinationPresentations = $derived(knownDestinationPresentations(
    presentationDestinations,
    $pathTableEntries,
    $chatAnnounces,
    $chatContacts,
    $nomadAnnounces,
    $propagationNodeAnnounces,
    $provisioningNodes,
  ));
  const filteredKnownDestinations = $derived($knownDestinations.filter((entry) => (
    (!normalizedDestinationFilter || entry.destinationHash.includes(normalizedDestinationFilter))
    && (!destinationTypeFilter
      || destinationPresentations.get(entry.destinationHash)?.application === destinationTypeFilter)
  )));
  const filteredRemoteDestinations = $derived(sortKnownDestinationsByLastAnnounce(
    filteredKnownDestinations.filter((entry) => !entry.isLocal),
  ));
  const filteredLocalDestinations = $derived(sortKnownDestinationsByLastAnnounce(
    filteredKnownDestinations.filter((entry) => entry.isLocal),
  ));
  const groupedRemoteDestinations = $derived(groupKnownDestinationsByIdentity(
    filteredRemoteDestinations,
    groupDestinationsByIdentity,
  ));
  const displayedKnownDestinations = $derived<DisplayedKnownDestination[]>([
    ...groupedRemoteDestinations.flatMap((group) => {
      const grouped = groupDestinationsByIdentity && group.entries.length > 1;
      return group.entries.map((entry, index) => ({
        entry,
        identityGroupStart: grouped && index === 0,
        identityGroupCount: group.entries.length,
        identityPublicKey: group.publicKey,
        identityGroupPosition: grouped
          ? index === 0
            ? 'first' as const
            : index === group.entries.length - 1
              ? 'last' as const
              : 'middle' as const
          : undefined,
        localSectionStart: false,
      }));
    }),
    ...filteredLocalDestinations.map((entry, index) => ({
      entry,
      identityGroupStart: false,
      identityGroupCount: 1,
      identityPublicKey: undefined,
      identityGroupPosition: undefined,
      localSectionStart: index === 0,
    })),
  ]);
  const forgettableDestinationCount = $derived($knownDestinations.filter((entry) => !entry.isLocal).length);
  const filtersActive = $derived(Boolean(
    normalizedDestinationFilter
    || (activeTab === 'paths' && (interfaceFilter || hopFilter !== undefined))
    || (activeTab === 'destinations' && (destinationTypeFilter || groupDestinationsByIdentity)),
  ));
  const activeFilterCount = $derived(
    (normalizedDestinationFilter ? 1 : 0)
    + (activeTab === 'paths' && interfaceFilter ? 1 : 0)
    + (activeTab === 'paths' && hopFilter !== undefined ? 1 : 0)
    + (activeTab === 'destinations' && destinationTypeFilter ? 1 : 0)
    + (activeTab === 'destinations' && groupDestinationsByIdentity ? 1 : 0)
  );

  onMount(() => {
    scrollContainer = page.closest<HTMLElement>('main') ?? undefined;
    scrollContainer?.scrollTo({ top: 0, left: 0 });
    const updateScrollState = () => {
      scrollToTopVisible = currentPageScrollTop() > 0;
    };
    scrollContainer?.addEventListener('scroll', updateScrollState, { passive: true });
    window.addEventListener('scroll', updateScrollState, { passive: true });
    updateScrollState();
    return () => {
      if (highlightTimer !== undefined) clearTimeout(highlightTimer);
      scrollContainer?.removeEventListener('scroll', updateScrollState);
      window.removeEventListener('scroll', updateScrollState);
      scrollContainer = undefined;
    };
  });

  function currentPageScrollTop(): number {
    return Math.max(
      scrollContainer?.scrollTop ?? 0,
      window.scrollY,
      document.documentElement.scrollTop,
      document.body.scrollTop,
    );
  }

  function scrollPageToTop(): void {
    scrollToTopVisible = false;
    scrollContainer?.scrollTo({ top: 0, left: 0, behavior: 'smooth' });
    if (window.scrollY > 0 || document.documentElement.scrollTop > 0 || document.body.scrollTop > 0) {
      window.scrollTo({ top: 0, left: 0, behavior: 'smooth' });
    }
  }

  function operationIsBusy(key: string): boolean {
    return busyOperations.includes(key);
  }

  async function runOperation(key: string, operation: () => Promise<boolean>): Promise<boolean> {
    if (operationIsBusy(key)) return false;
    busyOperations = [...busyOperations, key];
    try {
      return await operation();
    } finally {
      busyOperations = busyOperations.filter((item) => item !== key);
    }
  }

  async function requestPath(selectedHash?: string): Promise<void> {
    const manualRequest = selectedHash === undefined;
    const hash = selectedHash ?? normalizedDestination;
    if (manualRequest) validationVisible = true;
    const operationKey = hash ? `request:${hash}` : '';
    if (!hash || $runtimeStatus !== 'online' || operationIsBusy(operationKey)) return;
    busyOperations = [...busyOperations, operationKey];
    const destination = shortHash(hash);
    const controller = new AbortController();
    const activity = liveActivity.start(
      'pathManagement.activity.pending',
      { destination },
      () => controller.abort(),
    );
    try {
      const result = await reticulumRuntime.requestDestinationPath(hash, controller.signal);
      if (result.code === 'PATH_REQUEST_CANCELLED') {
        activity.dismiss();
        return;
      }
      if (result.ok) {
        activity.success(
          result.hops === undefined
            ? 'pathManagement.activity.success'
            : result.hops === 1
              ? 'pathManagement.activity.successOneHop'
              : 'pathManagement.activity.successManyHops',
          { destination, ...(result.hops === undefined ? {} : { count: result.hops }) },
        );
      } else if (result.code === 'PATH_REQUEST_TIMEOUT') {
        activity.error('pathManagement.activity.timeout', { destination });
      } else {
        activity.error('pathManagement.activity.failed', { destination });
      }
    } catch {
      activity.error('pathManagement.activity.failed', { destination });
    } finally {
      busyOperations = busyOperations.filter((item) => item !== operationKey);
    }
  }

  async function deletePath(hash: string): Promise<void> {
    const ok = await runOperation(`path:${hash}`, () => reticulumRuntime.dropDestinationPath(hash));
    toast[ok ? 'success' : 'error'](ok
      ? 'pathManagement.path.deleted'
      : 'pathManagement.path.deleteFailed');
  }

  async function confirmDestructiveAction(): Promise<void> {
    const pending = confirmation;
    if (!pending) return;
    let ok = false;
    if (pending.kind === 'forget') {
      ok = await runOperation(
        `destination:${pending.destinationHash}`,
        () => reticulumRuntime.forgetKnownDestination(pending.destinationHash),
      );
      toast[ok ? 'success' : 'error'](ok
        ? 'pathManagement.destination.forgotten'
        : 'pathManagement.destination.forgetFailed');
    } else if (pending.kind === 'clearPaths') {
      ok = await runOperation('clearPaths', () => reticulumRuntime.clearDestinationPaths());
      toast[ok ? 'success' : 'error'](ok
        ? 'pathManagement.paths.cleared'
        : 'pathManagement.paths.clearFailed');
    } else {
      ok = await runOperation('clearDestinations', () => reticulumRuntime.clearKnownDestinations());
      toast[ok ? 'success' : 'error'](ok
        ? 'pathManagement.destinations.cleared'
        : 'pathManagement.destinations.clearFailed');
    }
    confirmation = undefined;
  }

  function interfaceName(interfaceId: string | undefined): string {
    if (!interfaceId) return $t('pathManagement.entry.unknown');
    return $statusDetails?.interfaces.find((item) => item.id === interfaceId)?.name ?? interfaceId;
  }

  function interfaceType(interfaceId: string | undefined): string {
    const type = $statusDetails?.interfaces.find((item) => item.id === interfaceId)?.type;
    return type ? $t(`status.interface.type.${type}`) : $t('pathManagement.entry.unknown');
  }

  function shortHash(value: string): string {
    return `${value.slice(0, 8)}…${value.slice(-6)}`;
  }

  function shortPublicKey(value: string): string {
    return `${value.slice(0, 12)}…${value.slice(-8)}`;
  }

  function applicationLabel(application: KnownDestinationApplication): string {
    return $t(`pathManagement.destination.application.${application}`);
  }

  function openEntryActions(
    destination: string,
    counterpartTab: ManagementTab,
    clientX: number,
    clientY: number,
    method: ContextMenuOpenMethod,
  ): void {
    entryActions = {
      destinationHash: destination,
      counterpartTab,
      x: clientX,
      y: clientY,
      autofocus: method === 'keyboard',
      guardOpeningRelease: method === 'longpress',
    };
  }

  async function copyDestinationHash(destination: string): Promise<void> {
    entryActions = undefined;
    if (await copyText(destination)) toast.success('common.copied');
    else toast.error('common.copyFailed');
  }

  function probeDestination(destination: string): void {
    const presentation = destinationPresentations.get(destination);
    if (!presentation?.fullDestinationName) return;
    entryActions = undefined;
    showDestinationProbeActivity({
      destinationHash: destination,
      displayName: presentation?.localContactName ?? presentation?.announcedName,
      fullDestinationName: presentation.fullDestinationName,
      timeoutMs: probeTimeoutMsForPath($destinationPathStatuses[destination]),
    });
  }

  function showEntryCounterpart(): void {
    if (!entryActions) return;
    const { destinationHash: destination, counterpartTab } = entryActions;
    entryActions = undefined;
    void navigateToCounterpart(destination, counterpartTab);
  }

  function hasCounterpart(destination: string, targetTab: ManagementTab): boolean {
    return targetTab === 'paths'
      ? $pathTableEntries.some((entry) => entry.destinationHash === destination)
      : $knownDestinations.some((entry) => entry.destinationHash === destination);
  }

  async function navigateToCounterpart(destination: string, targetTab: ManagementTab): Promise<void> {
    if (!hasCounterpart(destination, targetTab)) return;
    activeTab = targetTab;
    clearFilters();
    filtersExpanded = false;
    highlightedDestination = undefined;
    await tick();
    highlightedDestination = destination;
    await tick();
    const counterpart = page.querySelector<HTMLElement>(
      `[data-destination-hash="${destination}"]`,
    );
    counterpart?.scrollIntoView?.({
      behavior: 'smooth',
      block: 'center',
    });
    if (highlightTimer !== undefined) clearTimeout(highlightTimer);
    highlightTimer = setTimeout(() => {
      if (highlightedDestination === destination) highlightedDestination = undefined;
      highlightTimer = undefined;
    }, counterpartHighlightDurationMs);
  }

  function clearFilters(): void {
    destinationFilter = '';
    interfaceFilter = '';
    hopFilter = undefined;
    destinationTypeFilter = '';
    groupDestinationsByIdentity = false;
  }
</script>

<div class="page path-management-page" bind:this={page}>
  <header class="page-header provisioning-header path-management-header">
    <button class="button secondary compact provisioning-back-button" type="button" onclick={() => navigateBack('tools')}>
      <Icon name="arrow-left" size={16} />{$t('pathManagement.backToTools')}
    </button>
    <div class="provisioning-header-copy">
      <p class="eyebrow">{$t('app.name')}</p>
      <h1>{$t('pathManagement.title')}</h1>
      <p>{$t('pathManagement.description')}</p>
    </div>
  </header>

  <section class="settings-card path-request-card" aria-labelledby="path-request-heading">
    <header class="settings-card-header">
      <div class="section-icon"><Icon name="route" size={21} /></div>
      <div>
        <h2 id="path-request-heading">{$t('pathManagement.request.title')}</h2>
        <p>{$t('pathManagement.request.description')}</p>
      </div>
    </header>
    <form class="path-request-form" onsubmit={(event) => { event.preventDefault(); void requestPath(); }}>
      <div class="field">
        <label for="path-management-destination">{$t('pathManagement.destination.label')}</label>
        <input
          id="path-management-destination"
          bind:value={destinationHash}
          placeholder={$t('pathManagement.destination.placeholder')}
          autocapitalize="none"
          autocomplete="off"
          spellcheck="false"
          aria-invalid={validationVisible && !normalizedDestination}
          oninput={() => { validationVisible = false; }}
        />
        <small class:field-error={validationVisible && !normalizedDestination}>
          {$t(validationVisible && !normalizedDestination
            ? 'pathManagement.destination.invalid'
            : 'pathManagement.destination.help')}
        </small>
      </div>
      <button
        class="button primary"
        type="submit"
        disabled={$runtimeStatus !== 'online'
          || Boolean(normalizedDestination && operationIsBusy(`request:${normalizedDestination}`))}
      >
        <Icon name="send" size={17} />
        {normalizedDestination && operationIsBusy(`request:${normalizedDestination}`)
          ? $t('pathManagement.request.pending')
          : $t('pathManagement.request.action')}
      </button>
    </form>
  </section>

  <section class="path-management-lists" aria-label={$t('pathManagement.tabs.label')}>
    <div class="path-management-toolbar">
      <div class="scope-tabs path-management-tabs" role="tablist" aria-label={$t('pathManagement.tabs.label')}>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'paths'}
          aria-controls="path-management-paths"
          class:active={activeTab === 'paths'}
          onclick={() => { activeTab = 'paths'; }}
        >
          {$t('pathManagement.tabs.paths')}
          <span>{$pathTableEntries.length}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'destinations'}
          aria-controls="path-management-destinations"
          class:active={activeTab === 'destinations'}
          onclick={() => { activeTab = 'destinations'; }}
        >
          {$t('pathManagement.tabs.destinations')}
          <span>{forgettableDestinationCount}</span>
        </button>
      </div>
      <button
        class="button secondary compact danger-text"
        type="button"
        disabled={activeTab === 'paths' ? $pathTableEntries.length === 0 : forgettableDestinationCount === 0}
        onclick={() => {
          confirmation = { kind: activeTab === 'paths' ? 'clearPaths' : 'clearDestinations' };
        }}
      >
        <Icon name="trash" size={16} />
        {$t('pathManagement.clear.all')}
      </button>
    </div>

    <button
      class="path-management-filters-toggle"
      type="button"
      aria-controls="path-management-filters"
      aria-expanded={filtersExpanded}
      onclick={() => { filtersExpanded = !filtersExpanded; }}
    >
      {#if filtersExpanded}<Icon name="chevron-down" size={17} />{/if}
      <span>
        {$t(filtersExpanded
          ? 'pathManagement.filter.hide'
          : activeFilterCount > 0
            ? 'pathManagement.filter.showActive'
            : 'pathManagement.filter.show', { count: activeFilterCount })}
      </span>
      {#if !filtersExpanded}
        <Icon name="chevron-down" size={17} />
      {/if}
    </button>

    <div
      id="path-management-filters"
      class="path-management-filters"
      class:destination-only={activeTab === 'destinations'}
      class:expanded={filtersExpanded}
    >
      <div class="search-field path-management-search">
        <Icon name="search" size={18} />
        <label class="sr-only" for="path-management-destination-filter">
          {$t('pathManagement.filter.destination.label')}
        </label>
        <input
          id="path-management-destination-filter"
          bind:value={destinationFilter}
          type="search"
          placeholder={$t('pathManagement.filter.destination.placeholder')}
          autocapitalize="none"
          autocomplete="off"
          spellcheck="false"
        />
        {#if filtersActive}
          <button
            class="path-management-filter-clear"
            type="button"
            aria-label={$t('pathManagement.filter.clear')}
            title={$t('pathManagement.filter.clear')}
            onclick={clearFilters}
          ><Icon name="close" size={16} /></button>
        {/if}
      </div>
      {#if activeTab === 'paths'}
        <label class="field path-management-filter-control">
          <span class="sr-only">{$t('pathManagement.filter.interface.label')}</span>
          <select bind:value={interfaceFilter}>
            <option value="">{$t('pathManagement.filter.interface.all')}</option>
            {#each $statusDetails?.interfaces ?? [] as interfaceDetails (interfaceDetails.id)}
              <option value={interfaceDetails.id}>{interfaceDetails.name}</option>
            {/each}
          </select>
        </label>
        <label class="field path-management-filter-control">
          <span class="sr-only">{$t('pathManagement.filter.hops.label')}</span>
          <input
            value={hopFilter ?? ''}
            type="number"
            min="0"
            max="128"
            step="1"
            placeholder={$t('pathManagement.filter.hops.placeholder')}
            oninput={(event) => {
              const value = event.currentTarget.value;
              const parsed = Number(value);
              hopFilter = value === '' || !Number.isFinite(parsed) ? undefined : parsed;
            }}
          />
        </label>
      {:else}
        <label class="field path-management-filter-control">
          <span class="sr-only">{$t('pathManagement.filter.destinationType.label')}</span>
          <select bind:value={destinationTypeFilter}>
            <option value="">{$t('pathManagement.filter.destinationType.all')}</option>
            {#each destinationApplicationTypes as application}
              <option value={application}>{applicationLabel(application)}</option>
            {/each}
          </select>
        </label>
        <label class="known-destination-group-filter">
          <input type="checkbox" bind:checked={groupDestinationsByIdentity} />
          <span>{$t('pathManagement.filter.groupByIdentity')}</span>
        </label>
      {/if}
    </div>

    {#if activeTab === 'paths'}
      <div id="path-management-paths" role="tabpanel">
        {#if $pathTableEntries.length === 0}
          <EmptyState
            icon="route-off"
            title={$t('pathManagement.paths.empty.title')}
            body={$t('pathManagement.paths.empty.body')}
          />
        {:else if filteredPathEntries.length === 0}
          <EmptyState
            icon="search"
            title={$t('pathManagement.filter.empty.title')}
            body={$t('pathManagement.filter.empty.body')}
          />
        {:else}
          <ol class="path-management-entry-list" aria-label={$t('pathManagement.paths.list')}>
            {#each filteredPathEntries as entry (entry.destinationHash)}
              {@const presentation = destinationPresentations.get(entry.destinationHash)}
              <PathManagementEntry
                destinationHash={entry.destinationHash}
                highlighted={highlightedDestination === entry.destinationHash}
                localContactName={presentation?.localContactName}
                announcedName={presentation?.announcedName}
                onopen={(x, y, method) => openEntryActions(
                  entry.destinationHash,
                  'destinations',
                  x,
                  y,
                  method,
                )}
              >
                {#snippet badges()}
                  <span class="path-management-entry-badge destination-type">
                    {applicationLabel(presentation?.application ?? 'unknown')}
                  </span>
                  <span class="path-management-entry-badge hop-count">
                    {$t(entry.hops === 1 ? 'announce.hops.one' : 'announce.hops.other', { count: entry.hops })}
                  </span>
                {/snippet}
                {#snippet details()}
                  {#if entry.nextHop}
                    <p class="probe-result-route path-management-route">
                      {$t('probe.history.route', {
                        via: entry.nextHop,
                        name: interfaceName(entry.interfaceId),
                        type: interfaceType(entry.interfaceId),
                      })}
                    </p>
                  {/if}
                  <dl>
                    <div>
                      <dt>{$t('pathManagement.entry.lastAnnounce')}</dt>
                      <dd>
                        {#if entry.lastAnnouncedAt}
                          <time datetime={entry.lastAnnouncedAt}>{dateFormatter.format(new Date(entry.lastAnnouncedAt))}</time>
                        {:else}
                          {$t('pathManagement.entry.unknown')}
                        {/if}
                      </dd>
                    </div>
                    <div>
                      <dt>{$t('pathManagement.entry.expires')}</dt>
                      <dd>
                        {#if entry.expiresAt}
                          <time datetime={entry.expiresAt}>{dateFormatter.format(new Date(entry.expiresAt))}</time>
                        {:else}
                          {$t('pathManagement.entry.unknown')}
                        {/if}
                      </dd>
                    </div>
                  </dl>
                {/snippet}
                {#snippet actions()}
                  <button
                    class="button secondary compact"
                    type="button"
                    disabled={$runtimeStatus !== 'online' || operationIsBusy(`request:${entry.destinationHash}`)}
                    onclick={() => void requestPath(entry.destinationHash)}
                  ><Icon name="sync" size={15} />{$t('pathManagement.entry.request')}</button>
                  <button
                    class="button secondary compact danger-text"
                    type="button"
                    disabled={operationIsBusy(`path:${entry.destinationHash}`)}
                    onclick={() => void deletePath(entry.destinationHash)}
                  ><Icon name="trash" size={15} />{$t('pathManagement.entry.deletePath')}</button>
                {/snippet}
              </PathManagementEntry>
            {/each}
          </ol>
        {/if}
      </div>
    {:else}
      <div id="path-management-destinations" role="tabpanel">
        {#if $knownDestinations.length === 0}
          <EmptyState
            icon="announce"
            title={$t('pathManagement.destinations.empty.title')}
            body={$t('pathManagement.destinations.empty.body')}
          />
        {:else if displayedKnownDestinations.length === 0}
          <EmptyState
            icon="search"
            title={$t('pathManagement.filter.empty.title')}
            body={$t('pathManagement.filter.empty.body')}
          />
        {:else}
          <ol class="path-management-entry-list" aria-label={$t('pathManagement.destinations.list')}>
            {#each displayedKnownDestinations as row (row.entry.destinationHash)}
              {@const entry = row.entry}
              {@const presentation = destinationPresentations.get(entry.destinationHash)}
              {#if row.identityGroupStart && row.identityPublicKey}
                <li class="known-destination-section-heading identity-group">
                  <span>{$t('pathManagement.destination.identityGroup', { count: row.identityGroupCount })}</span>
                  <code>{shortPublicKey(row.identityPublicKey)}</code>
                </li>
              {/if}
              {#if row.localSectionStart}
                <li class="known-destination-section-heading local">
                  <span>{$t('pathManagement.destination.localSection')}</span>
                </li>
              {/if}
              <PathManagementEntry
                destinationHash={entry.destinationHash}
                highlighted={highlightedDestination === entry.destinationHash}
                identityGroupPosition={row.identityGroupPosition}
                local={entry.isLocal}
                localContactName={presentation?.localContactName}
                announcedName={presentation?.announcedName}
                showActions={!entry.isLocal}
                onopen={(x, y, method) => openEntryActions(
                  entry.destinationHash,
                  'paths',
                  x,
                  y,
                  method,
                )}
              >
                {#snippet badges()}
                  <span class="path-management-entry-badge destination-type">
                    {applicationLabel(presentation?.application ?? 'unknown')}
                  </span>
                  {#if !entry.isLocal}
                    {#if presentation?.path}
                      <span class="path-management-entry-badge hop-count">
                        {$t(presentation.path.hops === 1 ? 'announce.hops.one' : 'announce.hops.other', {
                          count: presentation.path.hops,
                        })}
                      </span>
                    {:else}
                      <span class="path-management-entry-badge path-unavailable">
                        {$t('pathManagement.destination.path.unavailable')}
                      </span>
                    {/if}
                  {/if}
                {/snippet}
                {#snippet details()}
                  {#if !entry.isLocal}
                    <dl class="known-destination-public-key">
                      <div class="path-management-public-key">
                        <dt>{$t('pathManagement.entry.publicKey')}</dt>
                        <dd><code>{entry.publicKey ?? $t('pathManagement.entry.unknown')}</code></dd>
                      </div>
                    </dl>
                  {/if}
                  <dl class="known-destination-metrics">
                    <div>
                      <dt>{$t('pathManagement.entry.lastAnnounce')}</dt>
                      <dd>
                        {#if entry.lastAnnouncedAt}
                          <time datetime={entry.lastAnnouncedAt}>{dateFormatter.format(new Date(entry.lastAnnouncedAt))}</time>
                        {:else}
                          {$t('pathManagement.entry.unknown')}
                        {/if}
                      </dd>
                    </div>
                    {#if presentation?.lxmf}
                      <div>
                        <dt>{$t('pathManagement.destination.capability.stampCost')}</dt>
                        <dd>{presentation.lxmf.stampCost ?? $t('pathManagement.entry.unknown')}</dd>
                      </div>
                      <div>
                        <dt>{$t('pathManagement.destination.capability.compression')}</dt>
                        <dd>
                          {$t(presentation.lxmf.compressionSupported === undefined
                            ? 'pathManagement.entry.unknown'
                            : presentation.lxmf.compressionSupported
                              ? 'pathManagement.destination.capability.supported'
                              : 'pathManagement.destination.capability.unsupported')}
                        </dd>
                      </div>
                    {/if}
                    {#if presentation?.propagation}
                      <div>
                        <dt>{$t('pathManagement.destination.capability.propagation')}</dt>
                        <dd>
                          {$t(presentation.propagation.enabled
                            ? 'pathManagement.destination.capability.enabled'
                            : 'pathManagement.destination.capability.disabled')}
                        </dd>
                      </div>
                      <div>
                        <dt>{$t('pathManagement.destination.capability.transferLimit')}</dt>
                        <dd>
                          {$t('pathManagement.destination.capability.kilobytes', {
                            value: numberFormatter.format(presentation.propagation.transferLimitKb),
                          })}
                        </dd>
                      </div>
                      <div>
                        <dt>{$t('pathManagement.destination.capability.syncLimit')}</dt>
                        <dd>
                          {$t('pathManagement.destination.capability.kilobytes', {
                            value: numberFormatter.format(presentation.propagation.syncLimitKb),
                          })}
                        </dd>
                      </div>
                      <div>
                        <dt>{$t('pathManagement.destination.capability.stampCost')}</dt>
                        <dd>{numberFormatter.format(presentation.propagation.stampCost)}</dd>
                      </div>
                      <div>
                        <dt>{$t('pathManagement.destination.capability.peeringCost')}</dt>
                        <dd>{numberFormatter.format(presentation.propagation.peeringCost)}</dd>
                      </div>
                    {/if}
                  </dl>
                {/snippet}
                {#snippet actions()}
                  {#if !entry.isLocal}
                    <button
                      class="button secondary compact"
                      type="button"
                      disabled={$runtimeStatus !== 'online' || operationIsBusy(`request:${entry.destinationHash}`)}
                      onclick={() => void requestPath(entry.destinationHash)}
                    ><Icon name="sync" size={15} />{$t('pathManagement.entry.request')}</button>
                    <button
                      class="button secondary compact danger-text"
                      type="button"
                      disabled={operationIsBusy(`destination:${entry.destinationHash}`)}
                      onclick={() => { confirmation = { kind: 'forget', destinationHash: entry.destinationHash }; }}
                    ><Icon name="trash" size={15} />{$t('pathManagement.entry.forget')}</button>
                  {/if}
                {/snippet}
              </PathManagementEntry>
            {/each}
          </ol>
        {/if}
      </div>
    {/if}
  </section>
  {#if scrollToTopVisible}
    <button
      class="icon-button message-scroll-latest path-management-scroll-top"
      type="button"
      title={$t('pathManagement.scrollToTop')}
      aria-label={$t('pathManagement.scrollToTop')}
      onclick={scrollPageToTop}
    ><Icon name="chevron-up" size={20} /></button>
  {/if}
</div>

{#if entryActions}
  <ContextMenu
    x={entryActions.x}
    y={entryActions.y}
    autofocus={entryActions.autofocus}
    guardOpeningRelease={entryActions.guardOpeningRelease}
    label={$t('pathManagement.contextMenu.label')}
    closeLabel={$t('pathManagement.contextMenu.close')}
    onclose={() => { entryActions = undefined; }}
  >
    <button
      role="menuitem"
      onclick={() => { void copyDestinationHash(entryActions!.destinationHash); }}
    >
      <Icon name="copy" size={17} />{$t('chat.destination.actions.copyHash')}
    </button>
    <button
      role="menuitem"
      disabled={!hasCounterpart(entryActions.destinationHash, entryActions.counterpartTab)}
      onclick={showEntryCounterpart}
    >
      <Icon
        name={entryActions.counterpartTab === 'paths' ? 'route' : 'announce'}
        size={17}
      />
      {$t(entryActions.counterpartTab === 'paths'
        ? 'pathManagement.contextMenu.showPath'
        : 'pathManagement.contextMenu.showDestination')}
    </button>
    <button
      role="menuitem"
      disabled={!destinationPresentations.get(entryActions.destinationHash)?.fullDestinationName
        || $pendingProbeDestinationHashes.has(entryActions.destinationHash)}
      onclick={() => { probeDestination(entryActions!.destinationHash); }}
    >
      <Icon name="probe" size={17} />{$t('chat.destination.actions.probe')}
    </button>
  </ContextMenu>
{/if}

{#if confirmation}
  <ConfirmationDialog
    titleId="path-management-confirmation-title"
    title={$t(confirmation.kind === 'forget'
      ? 'pathManagement.confirm.forget.title'
      : confirmation.kind === 'clearPaths'
        ? 'pathManagement.confirm.clearPaths.title'
        : 'pathManagement.confirm.clearDestinations.title')}
    description={$t(confirmation.kind === 'forget'
      ? 'pathManagement.confirm.forget.description'
      : confirmation.kind === 'clearPaths'
        ? 'pathManagement.confirm.clearPaths.description'
        : 'pathManagement.confirm.clearDestinations.description')}
    icon="trash"
    tone="danger"
    confirmLabel={$t(confirmation.kind === 'forget'
      ? 'pathManagement.confirm.forget.action'
      : confirmation.kind === 'clearPaths'
        ? 'pathManagement.confirm.clearPaths.action'
        : 'pathManagement.confirm.clearDestinations.action')}
    oncancel={() => { confirmation = undefined; }}
    onconfirm={confirmDestructiveAction}
  />
{/if}
