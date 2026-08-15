<script lang="ts">
  import type { ReticulumLogEntry, ReticulumLogLevel } from '../../domain/logging';
  import { createDateFormatter, locale, t, type MessageKey } from '../../i18n';
  import EmptyState from './EmptyState.svelte';
  import Icon from './Icon.svelte';

  type LogFilter = 'all' | ReticulumLogLevel;
  let {
    entries,
    emptyTitle,
    emptyBody,
    onclear,
  }: {
    entries: readonly ReticulumLogEntry[];
    emptyTitle: MessageKey;
    emptyBody: MessageKey;
    onclear: () => void;
  } = $props();

  let filter = $state<LogFilter>('all');
  const levels: LogFilter[] = ['all', 'debug', 'info', 'warning', 'error'];
  const dateFormatter = $derived(createDateFormatter($locale, { timeStyle: 'medium' }));
  const visibleLogs = $derived(
    [...entries].reverse().filter((entry) => filter === 'all' || entry.level === filter),
  );
</script>

<div class="log-filter" role="toolbar" aria-label={$t('logs.filter.label')}>
  <div class="log-filter-levels">
    {#each levels as level}
      <button class:active={filter === level} onclick={() => { filter = level; }}>
        {$t(`logs.level.${level}`)}
      </button>
    {/each}
  </div>
  <button
    class="log-clear"
    type="button"
    aria-label={$t('logs.clear')}
    title={$t('logs.clear')}
    disabled={entries.length === 0}
    onclick={onclear}
  ><Icon name="trash" size={15} /><span>{$t('logs.clear')}</span></button>
</div>

<section class="log-viewer" aria-live="polite">
  {#if visibleLogs.length === 0}
    <EmptyState icon="history" title={$t(emptyTitle)} body={$t(emptyBody)} />
  {:else}
    <ol class="log-list">
      {#each visibleLogs as entry (entry.id)}
        <li class="log-entry" class:error={entry.level === 'error'} class:warning={entry.level === 'warning'}>
          <div class="log-meta">
            <time datetime={entry.timestamp}>{dateFormatter.format(new Date(entry.timestamp))}</time>
            <span class="log-level {entry.level}">{$t(`logs.level.${entry.level}`)}</span>
            <span>{entry.source}</span>
          </div>
          <code>{entry.code}</code>
          {#if entry.details}
            <dl>
              {#each Object.entries(entry.details) as [name, value]}
                <div><dt>{name}</dt><dd>{String(value)}</dd></div>
              {/each}
            </dl>
          {/if}
        </li>
      {/each}
    </ol>
  {/if}
</section>
