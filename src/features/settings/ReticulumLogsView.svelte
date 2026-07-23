<script lang="ts">
  import { onMount } from 'svelte';
  import { navigateBack } from '../../app/router';
  import type { ReticulumLogLevel } from '../../domain/logging';
  import { createDateFormatter, locale, t } from '../../i18n';
  import { clearReticulumLogs, reticulumLogs } from '../../infrastructure/reticulum/runtime';
  import EmptyState from '../../lib/components/EmptyState.svelte';
  import Icon from '../../lib/components/Icon.svelte';

  type LogFilter = 'all' | ReticulumLogLevel;
  let filter = $state<LogFilter>('all');
  const levels: LogFilter[] = ['all', 'debug', 'info', 'warning', 'error'];
  const dateFormatter = $derived(createDateFormatter($locale, { timeStyle: 'medium' }));
  const visibleLogs = $derived(
    [...$reticulumLogs].reverse().filter((entry) => filter === 'all' || entry.level === filter),
  );
  let page: HTMLDivElement;

  onMount(() => {
    const main = page.closest('main');
    if (main) {
      main.scrollTop = 0;
      main.scrollLeft = 0;
    }
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  });
</script>

<div class="page logs-page" bind:this={page}>
  <header class="page-header provisioning-header logs-header">
    <button class="button secondary compact provisioning-back-button" type="button" onclick={() => navigateBack('tools')}>
      <Icon name="arrow-left" size={16} />{$t('provisioning.backToTools')}
    </button>
    <div class="provisioning-header-copy">
      <p class="eyebrow">{$t('app.name')}</p>
      <h1>{$t('logs.title')}</h1>
      <p>{$t('logs.subtitle')}</p>
    </div>
  </header>

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
      disabled={$reticulumLogs.length === 0}
      onclick={clearReticulumLogs}
    ><Icon name="trash" size={15} /><span>{$t('logs.clear')}</span></button>
  </div>

  <section class="log-viewer" aria-live="polite">
    {#if visibleLogs.length === 0}
      <EmptyState icon="history" title={$t('logs.empty.title')} body={$t('logs.empty.body')} />
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
</div>
