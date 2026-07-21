<script lang="ts">
  import { navigate, type AppRoute } from '../../app/router';
  import { t, type MessageKey } from '../../i18n';
  import Icon, { type IconName } from '../../lib/components/Icon.svelte';

  interface ToolDefinition {
    id: 'provisioning' | 'logs' | 'pathTable' | 'probe' | 'status';
    title: MessageKey;
    description: MessageKey;
    icon: IconName;
    available: boolean;
    route?: AppRoute;
  }

  const tools: ToolDefinition[] = [
    {
      id: 'provisioning',
      title: 'tools.provisioning.title',
      description: 'tools.provisioning.description',
      icon: 'network',
      available: true,
      route: 'provisioning',
    },
    {
      id: 'pathTable',
      title: 'tools.pathTable.title',
      description: 'tools.pathTable.description',
      icon: 'route',
      available: false,
    },
    {
      id: 'probe',
      title: 'tools.probe.title',
      description: 'tools.probe.description',
      icon: 'probe',
      available: false,
    },
    {
      id: 'status',
      title: 'tools.status.title',
      description: 'tools.status.description',
      icon: 'interface',
      available: true,
      route: 'status',
    },
    {
      id: 'logs',
      title: 'tools.logs.title',
      description: 'tools.logs.description',
      icon: 'history',
      available: true,
      route: 'logs',
    },
  ];
</script>

<div class="page tools-page">
  <header class="page-header tools-header">
    <div>
      <p class="eyebrow">{$t('app.name')}</p>
      <h1>{$t('tools.title')}</h1>
      <p>{$t('tools.description')}</p>
    </div>
  </header>

  <section class="tools-grid" aria-label={$t('tools.list.label')}>
    {#each tools as tool}
      {#if tool.available && tool.route}
        <button class="tool-card available" onclick={() => navigate(tool.route!)}>
          <span class="tool-icon"><Icon name={tool.icon} size={24} /></span>
          <span class="tool-copy">
            <h2>{$t(tool.title)}</h2>
            <span>{$t(tool.description)}</span>
          </span>
          <span class="tool-action">{$t('tools.open')}<Icon name="arrow-right" size={17} /></span>
        </button>
      {:else}
        <article class="tool-card unavailable">
          <span class="tool-icon"><Icon name={tool.icon} size={24} /></span>
          <span class="tool-copy">
            <span class="tool-title-line">
              <h2>{$t(tool.title)}</h2>
              <span class="badge">{$t('common.comingSoon')}</span>
            </span>
            <span>{$t(tool.description)}</span>
          </span>
        </article>
      {/if}
    {/each}
  </section>
</div>
