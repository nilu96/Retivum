<script lang="ts">
  import { onMount } from 'svelte';
  import { navigateBack } from '../../app/router';
  import { t } from '../../i18n';
  import { clearReticulumLogs, reticulumLogs } from '../../infrastructure/reticulum/runtime';
  import Icon from '../../lib/components/Icon.svelte';
  import LogViewer from '../../lib/components/LogViewer.svelte';

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

  <LogViewer
    entries={$reticulumLogs}
    emptyTitle="logs.empty.title"
    emptyBody="logs.empty.body"
    onclear={clearReticulumLogs}
  />
</div>
