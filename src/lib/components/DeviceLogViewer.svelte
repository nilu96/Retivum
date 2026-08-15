<script lang="ts">
  import { t, type MessageKey } from '../../i18n';
  import EmptyState from './EmptyState.svelte';
  import Icon from './Icon.svelte';

  type LogThreshold = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

  let { lines, onclear }: { lines: readonly string[]; onclear: () => void } = $props();
  let query = $state('');
  let threshold = $state<LogThreshold>(9);
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
    lineLevel(line) <= threshold
      && (normalizedQuery === '' || line.toLocaleLowerCase().includes(normalizedQuery))
  )));

  function lineLevel(line: string): LogThreshold {
    const marker = line.match(/\[(!!!|ERR|WRN|NOT|INF|VRB|DBG|---|\.\.\.)\]/)?.[1];
    return marker ? levelByMarker[marker] : 5;
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

<section class="log-viewer device-log-viewer" aria-live="polite">
  {#if visibleLines.length === 0}
    <EmptyState
      icon="history"
      title={$t('rnodeMaintenance.logs.empty.title')}
      body={$t('rnodeMaintenance.logs.empty.body')}
    />
  {:else}
    <ol class="device-log-lines">
      {#each visibleLines as line}
        <li><code>{line}</code></li>
      {/each}
    </ol>
  {/if}
</section>
