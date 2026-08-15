<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { t, type MessageKey } from '../../i18n';
  import EmptyState from './EmptyState.svelte';
  import Icon from './Icon.svelte';

  type LogThreshold = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
  interface DeviceLogLine {
    id: number;
    text: string;
  }

  let { lines, onclear }: { lines: readonly DeviceLogLine[]; onclear: () => void } = $props();
  let query = $state('');
  let threshold = $state<LogThreshold>(9);
  let viewer: HTMLElement;
  let list = $state<HTMLOListElement>();
  let scrollContainer: HTMLElement | undefined;
  let scrollToTopVisible = $state(false);
  let mounted = false;
  let previousLatestLineId: number | undefined;
  let preservationSequence = 0;
  const levels: Array<{ value: LogThreshold; label: MessageKey }> = [
    { value: 1, label: 'rnodeMaintenance.logs.level.critical' },
    { value: 2, label: 'rnodeMaintenance.logs.level.error' },
    { value: 3, label: 'rnodeMaintenance.logs.level.warning' },
    { value: 4, label: 'rnodeMaintenance.logs.level.notice' },
    { value: 5, label: 'rnodeMaintenance.logs.level.info' },
    { value: 6, label: 'rnodeMaintenance.logs.level.verbose' },
    { value: 7, label: 'rnodeMaintenance.logs.level.debug' },
    { value: 8, label: 'rnodeMaintenance.logs.level.trace' },
    { value: 9, label: 'rnodeMaintenance.logs.level.all' },
  ];
  const levelByMarker: Record<string, LogThreshold> = {
    '!!!': 1,
    ERR: 2,
    WRN: 3,
    NOT: 4,
    INF: 5,
    VRB: 6,
    DBG: 7,
    '---': 8,
    '...': 9,
  };
  const normalizedQuery = $derived(query.trim().toLocaleLowerCase());
  const visibleLines = $derived([...lines].reverse().filter((line) => (
    lineLevel(line.text) <= threshold
      && (normalizedQuery === '' || line.text.toLocaleLowerCase().includes(normalizedQuery))
  )));

  onMount(() => {
    mounted = true;
    scrollContainer = viewer.closest<HTMLElement>('main') ?? undefined;
    const updateScrollState = (): void => {
      scrollToTopVisible = currentPageScrollTop() > 0;
    };
    scrollContainer?.addEventListener('scroll', updateScrollState, { passive: true });
    window.addEventListener('scroll', updateScrollState, { passive: true });
    updateScrollState();
    return () => {
      mounted = false;
      preservationSequence += 1;
      scrollContainer?.removeEventListener('scroll', updateScrollState);
      window.removeEventListener('scroll', updateScrollState);
      scrollContainer = undefined;
    };
  });

  $effect.pre(() => {
    const latestLineId = lines.at(-1)?.id;
    const hasNewLines = mounted
      && previousLatestLineId !== undefined
      && latestLineId !== undefined
      && latestLineId !== previousLatestLineId;
    previousLatestLineId = latestLineId;
    if (hasNewLines) preserveVisibleLogPosition();
  });

  function lineLevel(line: string): LogThreshold {
    const marker = line.match(/\[(!!!|ERR|WRN|NOT|INF|VRB|DBG|---|\.\.\.)\]/)?.[1];
    return marker ? levelByMarker[marker] : 5;
  }

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

  function preserveVisibleLogPosition(): void {
    const lineElements = Array.from(list?.children ?? []) as HTMLElement[];
    const firstLine = lineElements[0];
    if (!firstLine) return;
    const viewportTop = scrollContainer && scrollContainer.scrollTop > 0
      ? Math.max(0, scrollContainer.getBoundingClientRect().top)
      : 0;
    if (firstLine.getBoundingClientRect().top >= viewportTop) return;
    const anchor = lineElements.find((element) => element.getBoundingClientRect().bottom > viewportTop);
    const anchorId = anchor?.dataset.deviceLogLine;
    if (!anchor || !anchorId) return;
    const previousTop = anchor.getBoundingClientRect().top;
    const sequence = ++preservationSequence;
    void tick().then(() => {
      if (!mounted || sequence !== preservationSequence) return;
      const nextAnchor = list?.querySelector<HTMLElement>(`[data-device-log-line="${anchorId}"]`);
      if (!nextAnchor) return;
      const offset = nextAnchor.getBoundingClientRect().top - previousTop;
      if (Math.abs(offset) < 0.5) return;
      if (scrollContainer && scrollContainer.scrollTop > 0) {
        scrollContainer.scrollTop += offset;
      } else {
        window.scrollBy({ top: offset, left: 0 });
      }
    });
  }
</script>

<div class="log-filter device-log-filter" role="toolbar" aria-label={$t('rnodeMaintenance.logs.filter.label')}>
  <div class="search-field device-log-search">
    <Icon name="search" size={17} />
    <label class="sr-only" for="device-log-search">{$t('rnodeMaintenance.logs.filter.text')}</label>
    <input
      id="device-log-search"
      type="search"
      bind:value={query}
      placeholder={$t('rnodeMaintenance.logs.filter.placeholder')}
    />
    {#if query}
      <button
        class="search-clear-button"
        type="button"
        aria-label={$t('common.clearSearch')}
        title={$t('common.clearSearch')}
        onclick={() => { query = ''; }}
      ><Icon name="close" size={16} /></button>
    {/if}
  </div>
  <label class="sr-only" for="device-log-level">{$t('rnodeMaintenance.logs.filter.level')}</label>
  <select id="device-log-level" class="device-log-level" bind:value={threshold}>
    {#each levels as level}
      <option value={level.value}>{$t(level.label)}</option>
    {/each}
  </select>
  <button
    class="log-clear device-log-clear"
    type="button"
    aria-label={$t('logs.clear')}
    title={$t('logs.clear')}
    disabled={lines.length === 0}
    onclick={onclear}
  ><Icon name="trash" size={15} /><span>{$t('logs.clear')}</span></button>
</div>

<section class="log-viewer device-log-viewer" aria-live="polite" bind:this={viewer}>
  {#if visibleLines.length === 0}
    <EmptyState
      icon="history"
      title={$t('rnodeMaintenance.logs.empty.title')}
      body={$t('rnodeMaintenance.logs.empty.body')}
    />
  {:else}
    <ol class="device-log-lines" bind:this={list}>
      {#each visibleLines as line (line.id)}
        <li data-device-log-line={line.id}><code>{line.text}</code></li>
      {/each}
    </ol>
  {/if}
</section>

{#if scrollToTopVisible}
  <button
    class="icon-button message-scroll-latest path-management-scroll-top"
    type="button"
    title={$t('rnodeMaintenance.logs.scrollToTop')}
    aria-label={$t('rnodeMaintenance.logs.scrollToTop')}
    onclick={scrollPageToTop}
  ><Icon name="chevron-up" size={20} /></button>
{/if}
