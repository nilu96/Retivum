<script lang="ts">
  import { onMount } from 'svelte';
  import { navigateBack } from '../../app/router';
  import { normalizeDestinationHash } from '../../domain/settings';
  import { createDateFormatter, locale, t } from '../../i18n';
  import { maximumProbePayloadBytes } from '../../infrastructure/reticulum/protocol';
  import {
    knownDestinationHashes,
    reticulumRuntime,
    runtimeStatus,
  } from '../../infrastructure/reticulum/runtime';
  import { clearProbeHistory, probeHistory } from '../../infrastructure/reticulum/probe-history';
  import {
    cancelPendingDestinationProbe,
    pendingProbeDestinationHashes,
  } from '../../infrastructure/reticulum/probe-operations';
  import EmptyState from '../../lib/components/EmptyState.svelte';
  import Icon from '../../lib/components/Icon.svelte';
  import { showDestinationProbeActivity } from '../../lib/notifications/probe-activity';

  const destinationNames = ['lxmf.delivery', 'rnstransport.probe'] as const;
  let page: HTMLDivElement;
  let destinationHash = $state('');
  let fullDestinationName = $state('lxmf.delivery');
  let timeoutSeconds = $state(20);
  let probeSizeBytes = $state(8);
  let droppingPath = $state(false);
  let destinationMenuOpen = $state(false);
  let nameMenuOpen = $state(false);
  let destinationPicker = $state<HTMLDivElement>();
  let namePicker = $state<HTMLDivElement>();
  let validationVisible = $state(false);
  let pathDropFeedback = $state<'dropped' | 'notFound' | undefined>();
  const completedAtFormatter = $derived(createDateFormatter($locale, { dateStyle: undefined, timeStyle: 'medium' }));
  const normalizedDestination = $derived(normalizeDestinationHash(destinationHash));
  const validTimeout = $derived(Number.isInteger(timeoutSeconds) && timeoutSeconds > 0 && timeoutSeconds <= 2_147_483);
  const validProbeSize = $derived(Number.isInteger(probeSizeBytes)
    && probeSizeBytes >= 0
    && probeSizeBytes <= maximumProbePayloadBytes);
  const validDestinationName = $derived(fullDestinationName.trim().length > 0
    && fullDestinationName.trim().split('.').every((component) => component.length > 0));
  const formValid = $derived(Boolean(normalizedDestination) && validDestinationName && validTimeout && validProbeSize);
  const destinationProbePending = $derived(Boolean(
    normalizedDestination && $pendingProbeDestinationHashes.has(normalizedDestination),
  ));
  const hasCompletedHistory = $derived($probeHistory.some((entry) => entry.status === 'completed'));
  const visibleDestinations = $derived.by(() => {
    const query = destinationHash.trim().toLowerCase();
    return query
      ? $knownDestinationHashes.filter((hash) => hash.includes(query))
      : $knownDestinationHashes;
  });

  onMount(() => {
    page.closest('main')?.scrollTo({ top: 0, left: 0 });
    const closeMenus = (event: PointerEvent) => {
      const target = event.target as Node;
      if (destinationMenuOpen && destinationPicker && !destinationPicker.contains(target)) destinationMenuOpen = false;
      if (nameMenuOpen && namePicker && !namePicker.contains(target)) nameMenuOpen = false;
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      destinationMenuOpen = false;
      nameMenuOpen = false;
    };
    document.addEventListener('pointerdown', closeMenus);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeMenus);
      document.removeEventListener('keydown', closeOnEscape);
    };
  });

  function selectDestination(hash: string): void {
    destinationHash = hash;
    validationVisible = false;
    pathDropFeedback = undefined;
    destinationMenuOpen = false;
  }

  function selectDestinationName(name: string): void {
    fullDestinationName = name;
    nameMenuOpen = false;
  }

  function probe(): void {
    validationVisible = true;
    pathDropFeedback = undefined;
    if (!formValid || !normalizedDestination || destinationProbePending) return;
    showDestinationProbeActivity({
      destinationHash: normalizedDestination,
      fullDestinationName,
      timeoutMs: timeoutSeconds * 1_000,
      probeSizeBytes,
      liveHistory: true,
    });
  }

  async function dropPath(): Promise<void> {
    validationVisible = true;
    pathDropFeedback = undefined;
    if (!normalizedDestination || droppingPath) return;
    droppingPath = true;
    try {
      pathDropFeedback = await reticulumRuntime.dropDestinationPath(normalizedDestination)
        ? 'dropped'
        : 'notFound';
    } finally {
      droppingPath = false;
    }
  }

  function formatRoundTripTime(value: number): string {
    return value >= 1_000
      ? $t('probe.history.rtt.seconds', { value: (value / 1_000).toFixed(3) })
      : $t('probe.history.rtt.milliseconds', { value: value.toFixed(2) });
  }
</script>

<div class="page probe-page" bind:this={page}>
  <header class="page-header provisioning-header probe-header">
    <button class="button secondary compact provisioning-back-button" type="button" onclick={() => navigateBack('tools')}>
      <Icon name="arrow-left" size={16} />{$t('probe.backToTools')}
    </button>
    <div class="provisioning-header-copy">
      <p class="eyebrow">{$t('app.name')}</p>
      <h1>{$t('probe.title')}</h1>
      <p>{$t('probe.description')}</p>
    </div>
  </header>

  <section class="settings-card probe-config-card" aria-labelledby="probe-config-heading">
    <header class="settings-card-header">
      <div class="section-icon"><Icon name="probe" size={21} /></div>
      <div><h2 id="probe-config-heading">{$t('probe.configuration.title')}</h2><p>{$t('probe.configuration.description')}</p></div>
    </header>
    <form class="probe-form" onsubmit={(event) => { event.preventDefault(); void probe(); }}>
      <div class="field full-span">
        <label for="probe-destination">{$t('probe.destination.label')}</label>
        <div class="propagation-node-combobox" bind:this={destinationPicker}>
          <input
            id="probe-destination"
            bind:value={destinationHash}
            placeholder={$t('probe.destination.placeholder')}
            autocapitalize="none"
            autocomplete="off"
            spellcheck="false"
            aria-invalid={validationVisible && !normalizedDestination}
            aria-autocomplete="list"
            aria-controls="probe-destination-options"
            aria-expanded={destinationMenuOpen}
            oninput={() => { validationVisible = false; pathDropFeedback = undefined; }}
          />
          <button
            type="button"
            class="propagation-node-menu-toggle"
            aria-label={$t('probe.destination.openList')}
            aria-haspopup="listbox"
            aria-expanded={destinationMenuOpen}
            onclick={() => { destinationMenuOpen = !destinationMenuOpen; nameMenuOpen = false; }}
          ><Icon name="chevron-down" size={17} /></button>
          {#if destinationMenuOpen}
            <div id="probe-destination-options" class="propagation-node-menu" role="listbox" aria-label={$t('probe.destination.list')}>
              {#if visibleDestinations.length === 0}
                <p>{$t('probe.destination.empty')}</p>
              {:else}
                {#each visibleDestinations as hash (hash)}
                  <button
                    type="button"
                    role="option"
                    aria-selected={normalizedDestination === hash}
                    onclick={() => selectDestination(hash)}
                  ><code>{hash}</code></button>
                {/each}
              {/if}
            </div>
          {/if}
        </div>
        <small class:field-error={validationVisible && !normalizedDestination}>
          {$t(validationVisible && !normalizedDestination ? 'probe.destination.invalid' : 'probe.destination.help')}
        </small>
      </div>

      <div class="field">
        <label for="probe-destination-name">{$t('probe.name.label')}</label>
        <div class="propagation-node-combobox probe-name-combobox" bind:this={namePicker}>
          <input
            id="probe-destination-name"
            bind:value={fullDestinationName}
            autocapitalize="none"
            autocomplete="off"
            spellcheck="false"
            aria-invalid={validationVisible && !validDestinationName}
            aria-autocomplete="list"
            aria-controls="probe-name-options"
            aria-expanded={nameMenuOpen}
            oninput={() => { validationVisible = false; }}
          />
          <button
            type="button"
            class="propagation-node-menu-toggle"
            aria-label={$t('probe.name.openList')}
            aria-haspopup="listbox"
            aria-expanded={nameMenuOpen}
            onclick={() => { nameMenuOpen = !nameMenuOpen; destinationMenuOpen = false; }}
          ><Icon name="chevron-down" size={17} /></button>
          {#if nameMenuOpen}
            <div id="probe-name-options" class="propagation-node-menu" role="listbox" aria-label={$t('probe.name.list')}>
              {#each destinationNames as name}
                <button
                  type="button"
                  role="option"
                  aria-selected={fullDestinationName === name}
                  onclick={() => selectDestinationName(name)}
                ><code>{name}</code></button>
              {/each}
            </div>
          {/if}
        </div>
        <small class:field-error={validationVisible && !validDestinationName}>{$t('probe.name.help')}</small>
      </div>

      <label class="field">
        <span>{$t('probe.timeout.label')}</span>
        <input
          type="number"
          min="1"
          max="2147483"
          step="1"
          bind:value={timeoutSeconds}
          aria-invalid={validationVisible && !validTimeout}
        />
        <small class:field-error={validationVisible && !validTimeout}>{$t('probe.timeout.help')}</small>
      </label>

      <label class="field">
        <span>{$t('probe.size.label')}</span>
        <input
          type="number"
          min="0"
          max={maximumProbePayloadBytes}
          step="1"
          bind:value={probeSizeBytes}
          aria-invalid={validationVisible && !validProbeSize}
        />
        <small class:field-error={validationVisible && !validProbeSize}>
          {$t('probe.size.help', { maximum: maximumProbePayloadBytes })}
        </small>
      </label>

      <div class="probe-actions full-span">
        <button
          class="button primary"
          type="submit"
          disabled={destinationProbePending || $runtimeStatus !== 'online'}
        ><Icon name="probe" size={17} />{destinationProbePending ? $t('probe.action.probing') : $t('probe.action.start')}</button>
        <button
          class="button secondary danger-text"
          type="button"
          disabled={destinationProbePending || droppingPath || !normalizedDestination}
          onclick={() => void dropPath()}
        ><Icon name="route" size={17} />{droppingPath ? $t('probe.action.droppingPath') : $t('probe.action.dropPath')}</button>
        {#if pathDropFeedback}
          <p class:success={pathDropFeedback === 'dropped'} class="probe-path-feedback" role="status">
            {$t(pathDropFeedback === 'dropped' ? 'probe.path.dropped' : 'probe.path.notFound')}
          </p>
        {/if}
      </div>
    </form>
  </section>

  <section class="probe-history-section" aria-labelledby="probe-history-heading">
    <div class="section-heading-row">
      <div class="section-title-with-count">
        <h2 id="probe-history-heading">{$t('probe.history.title')}</h2>
        <span class="badge section-count-badge">{$probeHistory.length}</span>
      </div>
      <button class="button secondary compact" type="button" disabled={!hasCompletedHistory} onclick={clearProbeHistory}>
        <Icon name="trash" size={16} />{$t('probe.history.clear')}
      </button>
    </div>

    {#if $probeHistory.length === 0}
      <EmptyState icon="history" title={$t('probe.history.empty.title')} body={$t('probe.history.empty.body')} />
    {:else}
      <ol class="probe-history-list" aria-label={$t('probe.history.list')}>
        {#each $probeHistory as entry (entry.id)}
          <li class:failed={entry.status === 'completed' && !entry.ok} class:pending={entry.status === 'pending'}>
            <header>
              <div class="probe-result-title">
                <span class="probe-result-dot" aria-hidden="true"></span>
                <strong>{$t(entry.status === 'pending'
                  ? 'probe.history.waiting'
                  : entry.ok ? 'probe.history.success' : 'probe.history.failure')}</strong>
              </div>
              {#if entry.status === 'pending'}
                <button
                  class="button secondary compact probe-cancel-button"
                  type="button"
                  aria-label={$t('probe.history.cancel')}
                  onclick={() => cancelPendingDestinationProbe(entry.destinationHash)}
                ><Icon name="close" size={14} />{$t('common.cancel')}</button>
              {:else}
                <time datetime={entry.completedAt}>{completedAtFormatter.format(new Date(entry.completedAt))}</time>
              {/if}
            </header>
            <code class="probe-result-destination">{entry.destinationHash}</code>
            {#if entry.status === 'completed' && entry.viaHash && entry.interfaceName && entry.interfaceType}
              <p class="probe-result-route">{$t('probe.history.route', {
                via: entry.viaHash,
                name: entry.interfaceName,
                type: $t(`status.interface.type.${entry.interfaceType}`),
              })}</p>
            {/if}
            <dl>
              <div><dt>{$t('probe.history.name')}</dt><dd><code>{entry.fullDestinationName}</code></dd></div>
              <div><dt>{$t('probe.history.size')}</dt><dd>{$t('probe.history.bytes', { count: entry.probeSizeBytes })}</dd></div>
              {#if entry.status === 'completed' && entry.ok && entry.roundTripTimeMs !== undefined}
                <div><dt>{$t('probe.history.rtt')}</dt><dd>{formatRoundTripTime(entry.roundTripTimeMs)}</dd></div>
              {/if}
              {#if entry.status === 'completed' && entry.ok && entry.hops !== undefined}
                <div><dt>{$t('probe.history.hops')}</dt><dd>{$t(entry.hops === 1 ? 'announce.hops.one' : 'announce.hops.other', { count: entry.hops })}</dd></div>
              {/if}
            </dl>
            {#if entry.status === 'completed' && !entry.ok}
              <p class="probe-result-error">{$t('probe.history.errorCode', { code: entry.code ?? 'PROBE_FAILED' })}</p>
            {/if}
          </li>
        {/each}
      </ol>
    {/if}
  </section>
</div>
