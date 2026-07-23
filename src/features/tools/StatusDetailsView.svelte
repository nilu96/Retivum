<script lang="ts">
  import { onMount } from 'svelte';
  import { navigateBack } from '../../app/router';
  import type { RNodeBatteryState } from '../../infrastructure/reticulum/protocol';
  import { reticulumRuntime, statusDetails } from '../../infrastructure/reticulum/runtime';
  import { t, type MessageKey } from '../../i18n';
  import EmptyState from '../../lib/components/EmptyState.svelte';
  import Icon from '../../lib/components/Icon.svelte';

  let page: HTMLDivElement;
  let expandedInterfaceIds = $state<Set<string>>(new Set());

  onMount(() => {
    page.closest('main')?.scrollTo({ top: 0, left: 0 });
  });

  function formatBytes(value: number): string {
    if (value < 1_000) return `${value} B`;
    if (value < 1_000_000) return `${(value / 1_000).toFixed(2)} KB`;
    if (value < 1_000_000_000) return `${(value / 1_000_000).toFixed(2)} MB`;
    return `${(value / 1_000_000_000).toFixed(2)} GB`;
  }

  function formatBitrate(value: number | undefined): string {
    if (value === undefined) return $t('status.metric.notMeasured');
    if (value < 1_000) return `${Math.round(value)} bps`;
    if (value < 1_000_000) return `${(value / 1_000).toFixed(2)} kbps`;
    return `${(value / 1_000_000).toFixed(2)} Mbps`;
  }

  function formatRate(value: number): string {
    return `${value === 0 ? '0' : value.toPrecision(3)}/s`;
  }

  function translated(key: string): string {
    return $t(key as MessageKey);
  }

  function battery(status: RNodeBatteryState | undefined, percent: number): string {
    return `${percent}% (${translated(`status.battery.${status ?? 'unknown'}`)})`;
  }

  function interfaceMetricsExpanded(id: string): boolean {
    return expandedInterfaceIds.has(id);
  }

  function toggleInterfaceMetrics(id: string): void {
    const next = new Set(expandedInterfaceIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    expandedInterfaceIds = next;
  }
</script>

<div class="page status-details-page" bind:this={page}>
  <header class="page-header provisioning-header status-details-header">
    <button class="button secondary compact provisioning-back-button" type="button" onclick={() => navigateBack('tools')}>
      <Icon name="arrow-left" size={16} />{$t('status.backToTools')}
    </button>
    <div class="provisioning-header-copy">
      <p class="eyebrow">{$t('app.name')}</p>
      <h1>{$t('status.title')}</h1>
      <p>{$t('status.subtitle')}</p>
    </div>
  </header>

  {#if $statusDetails}
    <section class="status-overview" aria-label={$t('status.network.title')}>
      <article class="network-status-card">
        <div class="network-status-block links-status-block">
          <header class="network-status-block-header">
            <span class="tool-icon"><Icon name="route" size={19} /></span>
            <span>{$t('status.links.active')}</span>
          </header>
          <div class="links-status-content">
            <strong class="active-link-count">{$statusDetails.network.activeLinks}</strong>
            <button
              class="button secondary compact"
              class:danger-text={$statusDetails.network.activeLinks > 0}
              type="button"
              disabled={$statusDetails.network.activeLinks === 0}
              onclick={() => reticulumRuntime.closeAllLinks()}
            >{$t('status.links.closeAll')}</button>
          </div>
        </div>

        <div class="network-status-block transport-status-block">
          <header class="network-status-block-header transport-status-header">
            <div class="network-status-block-title">
              <span class="tool-icon"><Icon name="network" size={20} /></span>
              <span>{$t('status.transport.title')}</span>
            </div>
            <span class:enabled={$statusDetails.network.transportEnabled} class="transport-status-pill">
              <span class="transport-status-dot" aria-hidden="true"></span>
              {$statusDetails.network.transportEnabled ? $t('common.enabled') : $t('common.disabled')}
            </span>
          </header>
          {#if $statusDetails.network.transportEnabled}
            <dl class="transport-summary-details">
              <div class="transport-hash">
                <dt>{$t('status.transport.hash')}</dt>
                <dd><code>{$statusDetails.network.transportHashHex}</code></dd>
              </div>
              <div class="transport-packets">
                <dt>{$t('status.transport.packets')}</dt>
                <dd><strong>{$statusDetails.network.transportedPackets}</strong></dd>
              </div>
            </dl>
          {/if}
        </div>
      </article>
    </section>

    <section class="status-interface-section" aria-labelledby="status-interface-heading">
      <div class="section-heading-row">
        <div class="section-title-with-count">
          <h2 id="status-interface-heading">{$t('status.interfaces.title')}</h2>
          <span class="badge section-count-badge">{$statusDetails.interfaces.length}</span>
        </div>
      </div>

      {#if $statusDetails.interfaces.length === 0}
        <EmptyState icon="interface" title={$t('status.interfaces.empty.title')} body={$t('status.interfaces.empty.body')} />
      {:else}
        <div class="status-interface-list" aria-live="polite">
          {#each $statusDetails.interfaces as status (status.id)}
            <article class:metrics-expanded={interfaceMetricsExpanded(status.id)} class="status-interface-card">
              <header>
                <div class="status-interface-name">
                  <span class="tool-icon"><Icon name={status.type === 'rnode' ? 'radio' : 'interface'} size={22} /></span>
                  <div>
                    <h3>{status.name}</h3>
                    <span class="status-interface-type">
                      {translated(`status.interface.type.${status.type}`)}
                      {#if status.type === 'rnode' && status.rnodeConnectionType}
                        <span aria-hidden="true">{' · '}</span>{translated(`interface.editor.rnode.connection.${status.rnodeConnectionType}`)}
                      {/if}
                    </span>
                  </div>
                </div>
                <span class="status-state-pill {status.state}">{translated(`interface.status.${status.state}`)}</span>
              </header>

              <div class="status-interface-metrics" id="status-interface-metrics-{status.id}">
                <dl class="status-metric-grid">
                  <div><dt>{$t('status.metric.mode')}</dt><dd>{translated(`interface.editor.mode.${status.mode}`)}</dd></div>
                  <div><dt>{$t('status.metric.bitrate')}</dt><dd>{formatBitrate(status.bitrateBps)}</dd></div>
                  <div><dt>{$t('status.metric.rxRate')}</dt><dd>{formatBitrate(status.rxRateBps)}</dd></div>
                  <div><dt>{$t('status.metric.txRate')}</dt><dd>{formatBitrate(status.txRateBps)}</dd></div>
                  <div><dt>{$t('status.metric.rxBytes')}</dt><dd>{formatBytes(status.rxBytes)}</dd></div>
                  <div><dt>{$t('status.metric.txBytes')}</dt><dd>{formatBytes(status.txBytes)}</dd></div>
                  <div><dt>{$t('status.metric.rxPackets')}</dt><dd>{status.rxPackets}</dd></div>
                  <div><dt>{$t('status.metric.txPackets')}</dt><dd>{status.txPackets}</dd></div>
                  <div><dt>{$t('status.metric.incomingAnnounces')}</dt><dd>{status.incomingAnnounces}</dd></div>
                  <div><dt>{$t('status.metric.outgoingAnnounces')}</dt><dd>{status.outgoingAnnounces}</dd></div>
                  <div><dt>{$t('status.metric.incomingAnnounceRate')}</dt><dd>{formatRate(status.incomingAnnouncesPerSecond)}</dd></div>
                  <div><dt>{$t('status.metric.outgoingAnnounceRate')}</dt><dd>{formatRate(status.outgoingAnnouncesPerSecond)}</dd></div>
                </dl>

                {#if status.rnode}
                  <section class="status-radio-details" aria-label={$t('status.rnode.title')}>
                    <header>
                      <Icon name="radio" size={17} />
                      <h4>{$t('status.rnode.title')}</h4>
                    </header>
                    <dl class="status-metric-grid status-radio-metric-grid">
                      {#if status.rnode.radioRxPackets !== undefined}
                        <div><dt>{$t('status.metric.radioRxPackets')}</dt><dd>{status.rnode.radioRxPackets}</dd></div>
                      {/if}
                      {#if status.rnode.radioTxPackets !== undefined}
                        <div><dt>{$t('status.metric.radioTxPackets')}</dt><dd>{status.rnode.radioTxPackets}</dd></div>
                      {/if}
                      {#if status.rnode.noiseFloorDbm !== undefined}
                        <div><dt>{$t('status.metric.noiseFloor')}</dt><dd>{status.rnode.noiseFloorDbm} dBm</dd></div>
                      {/if}
                      {#if status.rnode.batteryPercent !== undefined}
                        <div><dt>{$t('status.metric.battery')}</dt><dd>{battery(status.rnode.batteryState, status.rnode.batteryPercent)}</dd></div>
                      {/if}
                      {#if status.rnode.lastPacketRssiDbm !== undefined}
                        <div><dt>{$t('status.metric.lastRssi')}</dt><dd>{status.rnode.lastPacketRssiDbm} dBm</dd></div>
                      {/if}
                      {#if status.rnode.lastPacketSnrDb !== undefined}
                        <div><dt>{$t('status.metric.lastSnr')}</dt><dd>{status.rnode.lastPacketSnrDb} dB</dd></div>
                      {/if}
                      {#if status.rnode.airtimeShortPercent !== undefined && status.rnode.airtimeLongPercent !== undefined}
                        <div><dt>{$t('status.metric.airtime')}</dt><dd>{status.rnode.airtimeShortPercent}% (15s), {status.rnode.airtimeLongPercent}% (1h)</dd></div>
                      {/if}
                      {#if status.rnode.channelLoadShortPercent !== undefined && status.rnode.channelLoadLongPercent !== undefined}
                        <div><dt>{$t('status.metric.channelLoad')}</dt><dd>{status.rnode.channelLoadShortPercent}% (15s), {status.rnode.channelLoadLongPercent}% (1h)</dd></div>
                      {/if}
                    </dl>
                  </section>
                {/if}
              </div>

              <button
                class="status-metrics-toggle"
                type="button"
                aria-controls="status-interface-metrics-{status.id}"
                aria-expanded={interfaceMetricsExpanded(status.id)}
                onclick={() => toggleInterfaceMetrics(status.id)}
              >
                <span>{$t(interfaceMetricsExpanded(status.id) ? 'status.metrics.showLess' : 'status.metrics.showMore')}</span>
                <Icon name="chevron-down" size={16} />
              </button>
            </article>
          {/each}
        </div>
      {/if}
    </section>
  {:else}
    <EmptyState icon="interface" title={$t('status.loading.title')} body={$t('status.loading.body')} />
  {/if}
</div>
