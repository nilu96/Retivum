<script lang="ts">
  import { onMount } from 'svelte';
  import { navigateBack } from '../../app/router';
  import { knownFullDestinationNames } from '../../domain/known-destination';
  import { normalizeDestinationHash } from '../../domain/settings';
  import { t } from '../../i18n';
  import {
    clearDestinationHashHistory,
    destinationHashHistory,
    recordDestinationHashGeneration,
    type DestinationHashHistoryEntry,
  } from '../../infrastructure/reticulum/destination-hash-history';
  import {
    destinationHashFromIdentity,
    normalizeFullDestinationName,
  } from '../../infrastructure/reticulum/destination-hash';
  import { disabledPathRequestDestinationHashes } from '../../infrastructure/reticulum/path-request-operations';
  import { runtimeStatus } from '../../infrastructure/reticulum/runtime';
  import { copyText } from '../../lib/clipboard';
  import {
    contextMenuTrigger,
    type ContextMenuOpenMethod,
  } from '../../lib/actions/contextMenuTrigger';
  import ContextMenu from '../../lib/components/ContextMenu.svelte';
  import EmptyState from '../../lib/components/EmptyState.svelte';
  import Icon from '../../lib/components/Icon.svelte';
  import { showDestinationPathRequestActivity } from '../../lib/notifications/path-request-activity';
  import { toast } from '../../lib/notifications/toasts';

  let page: HTMLDivElement;
  let identityHash = $state('');
  let fullDestinationName = $state('lxmf.delivery');
  let validationVisible = $state(false);
  let generating = $state(false);
  let nameMenuOpen = $state(false);
  let namePicker = $state<HTMLDivElement>();
  let historyActions = $state<{
    entry: DestinationHashHistoryEntry;
    x: number;
    y: number;
    autofocus: boolean;
    guardOpeningRelease: boolean;
  }>();
  const normalizedIdentityHash = $derived(normalizeDestinationHash(identityHash));
  const normalizedName = $derived(normalizeFullDestinationName(fullDestinationName));
  const formValid = $derived(Boolean(normalizedIdentityHash && normalizedName));
  onMount(() => {
    page.closest('main')?.scrollTo({ top: 0, left: 0 });
    const closeMenu = (event: PointerEvent) => {
      const target = event.target as Node;
      if (nameMenuOpen && namePicker && !namePicker.contains(target)) nameMenuOpen = false;
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') nameMenuOpen = false;
    };
    document.addEventListener('pointerdown', closeMenu);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeMenu);
      document.removeEventListener('keydown', closeOnEscape);
    };
  });

  function inputChanged(): void {
    validationVisible = false;
  }

  function selectDestinationName(name: string): void {
    fullDestinationName = name;
    inputChanged();
    nameMenuOpen = false;
  }

  async function generate(): Promise<void> {
    validationVisible = true;
    if (!formValid || !normalizedIdentityHash || !normalizedName || generating) return;
    generating = true;
    try {
      const destinationHash = await destinationHashFromIdentity(
        normalizedIdentityHash,
        normalizedName,
      );
      if (!destinationHash) throw new Error('destination hash derivation failed');
      recordDestinationHashGeneration(normalizedIdentityHash, normalizedName, destinationHash);
    } catch {
      toast.error('destinationHash.generateFailed');
    } finally {
      generating = false;
    }
  }

  async function copyDestinationHash(destinationHash: string): Promise<void> {
    if (await copyText(destinationHash)) toast.success('common.copied');
    else toast.error('common.copyFailed');
  }

  function openHistoryActions(
    entry: DestinationHashHistoryEntry,
    x: number,
    y: number,
    method: ContextMenuOpenMethod,
  ): void {
    historyActions = {
      entry,
      x,
      y,
      autofocus: method === 'keyboard',
      guardOpeningRelease: method === 'longpress',
    };
  }

  async function copyHistoryValue(value: string): Promise<void> {
    historyActions = undefined;
    if (await copyText(value)) toast.success('common.copied');
    else toast.error('common.copyFailed');
  }

  async function requestPath(destinationHash: string): Promise<void> {
    if (!destinationHash
      || $runtimeStatus !== 'online'
      || $disabledPathRequestDestinationHashes.has(destinationHash)) return;
    historyActions = undefined;
    await showDestinationPathRequestActivity(destinationHash)?.result;
  }
</script>

<div class="page destination-hash-page" bind:this={page}>
  <header class="page-header provisioning-header destination-hash-header">
    <button class="button secondary compact provisioning-back-button" type="button" onclick={() => navigateBack('tools')}>
      <Icon name="arrow-left" size={16} />{$t('destinationHash.backToTools')}
    </button>
    <div class="provisioning-header-copy">
      <p class="eyebrow">{$t('app.name')}</p>
      <h1>{$t('destinationHash.title')}</h1>
      <p>{$t('destinationHash.description')}</p>
    </div>
  </header>

  <section class="settings-card destination-hash-card" aria-labelledby="destination-hash-form-heading">
    <header class="settings-card-header">
      <div class="section-icon"><Icon name="fingerprint" size={21} /></div>
      <div>
        <h2 id="destination-hash-form-heading">{$t('destinationHash.form.title')}</h2>
        <p>{$t('destinationHash.form.description')}</p>
      </div>
    </header>

    <form class="destination-hash-form" onsubmit={(event) => { event.preventDefault(); void generate(); }}>
      <div class="field">
        <label for="destination-hash-identity">{$t('destinationHash.identityHash.label')}</label>
        <input
          id="destination-hash-identity"
          class="hash-input"
          bind:value={identityHash}
          placeholder={$t('destinationHash.identityHash.placeholder')}
          autocapitalize="none"
          autocomplete="off"
          spellcheck="false"
          aria-invalid={validationVisible && !normalizedIdentityHash}
          oninput={inputChanged}
        />
        <small class:field-error={validationVisible && !normalizedIdentityHash}>
          {$t(validationVisible && !normalizedIdentityHash
            ? 'destinationHash.identityHash.invalid'
            : 'destinationHash.identityHash.help')}
        </small>
      </div>

      <div class="field">
        <label for="destination-hash-aspect">{$t('destinationHash.aspectName.label')}</label>
        <div class="propagation-node-combobox" bind:this={namePicker}>
          <input
            id="destination-hash-aspect"
            bind:value={fullDestinationName}
            placeholder={$t('destinationHash.aspectName.placeholder')}
            autocapitalize="none"
            autocomplete="off"
            spellcheck="false"
            aria-invalid={validationVisible && !normalizedName}
            aria-autocomplete="list"
            aria-controls="destination-hash-aspect-options"
            aria-expanded={nameMenuOpen}
            oninput={inputChanged}
          />
          <button
            type="button"
            class="propagation-node-menu-toggle"
            aria-label={$t('destinationHash.aspectName.openList')}
            aria-haspopup="listbox"
            aria-expanded={nameMenuOpen}
            onclick={() => { nameMenuOpen = !nameMenuOpen; }}
          ><Icon name="chevron-down" size={17} /></button>
          {#if nameMenuOpen}
            <div
              id="destination-hash-aspect-options"
              class="propagation-node-menu"
              role="listbox"
              aria-label={$t('destinationHash.aspectName.list')}
            >
              {#each knownFullDestinationNames as name}
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
        <small class:field-error={validationVisible && !normalizedName}>
          {$t(validationVisible && !normalizedName
            ? 'destinationHash.aspectName.invalid'
            : 'destinationHash.aspectName.help')}
        </small>
      </div>

      <button class="button primary destination-hash-generate" type="submit" disabled={generating}>
        <Icon name="fingerprint" size={17} />{$t('destinationHash.generate')}
      </button>
    </form>

  </section>

  <section class="destination-hash-history-section" aria-labelledby="destination-hash-history-heading">
    <div class="section-heading-row">
      <div class="section-title-with-count">
        <h2 id="destination-hash-history-heading">{$t('destinationHash.history.title')}</h2>
        <span class="badge section-count-badge">{$destinationHashHistory.length}</span>
      </div>
      <button
        class="button secondary compact"
        type="button"
        disabled={$destinationHashHistory.length === 0}
        onclick={clearDestinationHashHistory}
      >
        <Icon name="trash" size={16} />{$t('destinationHash.history.clear')}
      </button>
    </div>

    {#if $destinationHashHistory.length === 0}
      <EmptyState
        icon="history"
        title={$t('destinationHash.history.empty.title')}
        body={$t('destinationHash.history.empty.body')}
      />
    {:else}
      <ol class="destination-hash-history-list" aria-label={$t('destinationHash.history.list')} aria-live="polite">
        {#each $destinationHashHistory as entry (`${entry.identityHash}:${entry.fullDestinationName}`)}
          <li>
            <div
              class="destination-hash-history-context-trigger"
              role="button"
              tabindex="0"
              aria-haspopup="menu"
              aria-label={$t('destinationHash.history.entryActions')}
              use:contextMenuTrigger={{
                onopen: (x, y, method) => openHistoryActions(entry, x, y, method),
              }}
            >
              <strong class="destination-hash-result-label">{$t('destinationHash.output.label')}</strong>
              <code class="destination-hash-result-value">{entry.destinationHash}</code>
              <dl>
                <div>
                  <dt>{$t('destinationHash.identityHash.label')}</dt>
                  <dd><code>{entry.identityHash}</code></dd>
                </div>
                <div>
                  <dt>{$t('destinationHash.aspectName.label')}</dt>
                  <dd><code>{entry.fullDestinationName}</code></dd>
                </div>
              </dl>
            </div>
            <div class="destination-hash-result-actions">
              <button
                class="button secondary compact history-inline-action"
                type="button"
                onclick={() => void copyDestinationHash(entry.destinationHash)}
              >
                <Icon name="copy" size={16} />{$t('destinationHash.output.copy')}
              </button>
            </div>
          </li>
        {/each}
      </ol>
    {/if}
  </section>
</div>

{#if historyActions}
  <ContextMenu
    x={historyActions.x}
    y={historyActions.y}
    autofocus={historyActions.autofocus}
    guardOpeningRelease={historyActions.guardOpeningRelease}
    label={$t('destinationHash.history.actions.label')}
    closeLabel={$t('destinationHash.history.actions.close')}
    onclose={() => { historyActions = undefined; }}
  >
    <button role="menuitem" onclick={() => void copyHistoryValue(historyActions!.entry.identityHash)}>
      <Icon name="copy" size={17} />{$t('destinationHash.history.actions.copyIdentityHash')}
    </button>
    <button role="menuitem" onclick={() => void copyHistoryValue(historyActions!.entry.fullDestinationName)}>
      <Icon name="copy" size={17} />{$t('destinationHash.history.actions.copyAspectName')}
    </button>
    <button
      role="menuitem"
      disabled={$runtimeStatus !== 'online'
        || $disabledPathRequestDestinationHashes.has(historyActions.entry.destinationHash)}
      onclick={() => void requestPath(historyActions!.entry.destinationHash)}
    >
      <Icon name="route" size={17} />{$t('destinationHash.history.actions.requestPath')}
    </button>
  </ContextMenu>
{/if}

<style>
  .destination-hash-page {
    display: grid;
    max-width: 900px;
    min-width: 0;
    align-content: start;
    gap: 26px;
  }

  .destination-hash-header { margin-block-end: -3px; }

  .destination-hash-form {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    align-items: start;
    gap: 16px;
    padding: 4px 20px 20px 70px;
  }

  .hash-input { font-family: "SFMono-Regular", Consolas, monospace; }

  .destination-hash-generate { justify-self: start; }

  .destination-hash-history-section { min-width: 0; }

  .destination-hash-history-section .section-heading-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  .destination-hash-history-section > :global(.empty-state) {
    width: 100%;
    max-width: none;
    padding-block: 54px;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface-1);
  }

  .destination-hash-history-list {
    display: grid;
    min-width: 0;
    gap: 9px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .destination-hash-history-list > li {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 10px 16px;
    padding: 15px 17px;
    border: 1px solid var(--border);
    border-radius: 11px;
    background: var(--surface-1);
  }

  .destination-hash-history-context-trigger {
    display: grid;
    min-width: 0;
    gap: 10px;
    border-radius: 7px;
    outline-offset: 5px;
  }

  .destination-hash-result-label { font-size: .8rem; }

  .destination-hash-result-value {
    min-width: 0;
    overflow-wrap: anywhere;
    color: var(--text);
    font-size: .82rem;
  }

  .destination-hash-history-context-trigger dl {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 22px;
    margin: 0;
  }

  .destination-hash-history-list dl > div { display: flex; min-width: 0; align-items: baseline; gap: 6px; }
  .destination-hash-history-list dt { color: var(--text-subtle); font-size: .64rem; }
  .destination-hash-history-list dd { min-width: 0; margin: 0; color: var(--text); font-size: .7rem; font-weight: 700; }
  .destination-hash-history-list dd code { overflow-wrap: anywhere; font-size: .68rem; }

  .destination-hash-result-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
  }

  @media (max-width: 720px) {
    .destination-hash-form { grid-template-columns: 1fr; padding: 0 16px 16px; }
    .destination-hash-generate { width: 100%; }
    .destination-hash-history-list > li {
      grid-template-columns: 1fr;
    }
    .destination-hash-result-actions {
      display: grid;
      justify-content: stretch;
    }
    .destination-hash-result-actions > .button { width: 100%; }
  }
</style>
