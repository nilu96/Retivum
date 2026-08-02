<script lang="ts">
  import {
    sortInterfaceConfigurations,
    type InterfaceConfig,
    type InterfaceType,
  } from '../../domain/settings';
  import { t } from '../../i18n';
  import { BrowserSettingsRepository } from '../../infrastructure/database/settings-repository';
  import { detectInterfaceCapabilities, supportedInterfaceTypes } from '../../infrastructure/platform/interface-capabilities';
  import {
    activeIdentity,
    appPreferences,
    reticulumRuntime,
  } from '../../infrastructure/reticulum/runtime';
  import Icon from '../../lib/components/Icon.svelte';
  import { toast } from '../../lib/notifications/toasts';
  import RNodeInterfaceEditor from '../settings/RNodeInterfaceEditor.svelte';
  import TcpInterfaceEditor from '../settings/TcpInterfaceEditor.svelte';
  import UdpInterfaceEditor from '../settings/UdpInterfaceEditor.svelte';
  import WebSocketInterfaceEditor from '../settings/WebSocketInterfaceEditor.svelte';
  import { interfaceTypeDescriptors } from '../settings/interface-types';

  let { onskip, oncomplete }: { onskip: () => void; oncomplete: () => void } = $props();

  const repository = new BrowserSettingsRepository();
  const interfaceCapabilities = detectInterfaceCapabilities();
  const availableInterfaceTypes = supportedInterfaceTypes(interfaceCapabilities);
  let displayName = $state('');
  let chosenDisplayName = $state<string>();
  let editorType = $state<InterfaceType>();
  let editorConfig = $state<InterfaceConfig>();
  let configuredInterfaces = $state<InterfaceConfig[]>([]);
  let identityCommitted = $state(false);
  let currentStep = $state<1 | 2 | 3>(1);

  const legacyDefaultDisplayName = $derived($t('settings.identity.legacyDefaultDisplayName'));
  const configuredDisplayName = $derived(chosenDisplayName ?? $activeIdentity?.displayName ?? '');
  const availableDescriptors = interfaceTypeDescriptors.filter((descriptor) => (
    availableInterfaceTypes.includes(descriptor.type)
  ));

  $effect(() => {
    if (
      currentStep === 1
      && $activeIdentity !== undefined
      && $activeIdentity.displayName.trim() !== ''
      && $activeIdentity.displayName !== legacyDefaultDisplayName
    ) currentStep = 2;
  });

  function saveIdentity(event: SubmitEvent): void {
    event.preventDefault();
    const normalized = displayName.trim();
    if (!normalized || !$activeIdentity) return;
    chosenDisplayName = normalized;
    currentStep = 2;
  }

  function openInterfaceEditor(type: InterfaceType, config?: InterfaceConfig): void {
    editorType = type;
    editorConfig = config;
  }

  function closeInterfaceEditor(): void {
    editorType = undefined;
    editorConfig = undefined;
  }

  async function saveInterface(config: InterfaceConfig): Promise<void> {
    try {
      await repository.saveInterface(config);
      if (
        chosenDisplayName
        && (!$activeIdentity?.displayName.trim() || $activeIdentity.displayName === legacyDefaultDisplayName)
        && !identityCommitted
      ) {
        let identitySaved = false;
        try {
          identitySaved = await reticulumRuntime.updateActiveIdentityDisplayName(chosenDisplayName);
        } catch {
          // Roll the staged interface back below so restarting still returns to onboarding.
        }
        if (!identitySaved) {
          await repository.deleteInterface(config.id);
          toast.error('settings.identity.displayName.saveError');
          return;
        }
        identityCommitted = true;
      }
      const currentInterfaces = $state.snapshot(configuredInterfaces);
      const nextInterfaces = sortInterfaceConfigurations(
        currentInterfaces.some((item) => item.id === config.id)
          ? currentInterfaces.map((item) => item.id === config.id ? config : item)
          : [...currentInterfaces, config],
      );
      await reticulumRuntime.applyConfiguration(
        $state.snapshot($appPreferences),
        nextInterfaces,
      );
      configuredInterfaces = nextInterfaces;
      closeInterfaceEditor();
    } catch {
      toast.error('settings.interfaces.saveError');
    }
  }
</script>

<main class="onboarding-page">
  <section class="onboarding-panel" aria-labelledby="onboarding-title">
    <header class="onboarding-header">
      <div class="onboarding-mark" aria-hidden="true"><Icon name="route" size={28} /></div>
      <p class="eyebrow">{$t('app.name')}</p>
      <h1 id="onboarding-title">{$t('onboarding.title')}</h1>
      <p>{$t('onboarding.description')}</p>
    </header>

    <ol class="onboarding-progress" aria-label={$t('onboarding.progress')}>
      <li class:active={currentStep === 1} class:complete={currentStep > 1}>
        <span>{currentStep > 1 ? '✓' : '1'}</span>
        <div><strong>{$t('onboarding.identity.step')}</strong><small>{$t('onboarding.identity.stepDescription')}</small></div>
      </li>
      <li class:active={currentStep === 2} class:complete={currentStep > 2}>
        <span>{currentStep > 2 ? '✓' : '2'}</span>
        <div><strong>{$t('onboarding.interface.step')}</strong><small>{$t('onboarding.interface.stepDescription')}</small></div>
      </li>
      <li class:active={currentStep === 3}>
        <span>3</span>
        <div><strong>{$t('onboarding.ready.step')}</strong><small>{$t('onboarding.ready.stepDescription')}</small></div>
      </li>
    </ol>

    <div class="onboarding-content">
      {#if !$activeIdentity}
        <div class="onboarding-loading" role="status">
          <Icon name="identity" size={25} />
          <p>{$t('onboarding.identity.preparing')}</p>
        </div>
      {:else if currentStep === 1}
        <div class="onboarding-step">
          <div class="onboarding-step-copy">
            <div class="section-icon identity"><Icon name="identity" size={21} /></div>
            <div>
              <h2>{$t('onboarding.identity.title')}</h2>
              <p>{$t('onboarding.identity.description')}</p>
            </div>
          </div>
          <form class="onboarding-form" onsubmit={saveIdentity}>
            <label class="field">
              <span>{$t('settings.identity.displayName')}</span>
              <input
                bind:value={displayName}
                maxlength="128"
                autocomplete="nickname"
                placeholder={$t('onboarding.identity.placeholder')}
              />
              <small>{$t('onboarding.identity.help')}</small>
            </label>
            <div class="onboarding-actions">
              <button class="button secondary" type="button" onclick={onskip}>{$t('onboarding.skip')}</button>
              <button
                class="button primary"
                type="submit"
                disabled={!displayName.trim()}
              >
                {$t('onboarding.next')}
                <Icon name="arrow-right" size={17} />
              </button>
            </div>
          </form>
        </div>
      {:else if currentStep === 2}
        <div class="onboarding-step">
          <div class="onboarding-step-copy">
            <div class="section-icon"><Icon name="interface" size={21} /></div>
            <div>
              <h2>{$t('onboarding.interface.title')}</h2>
              <p>{$t('onboarding.interface.description')}</p>
            </div>
          </div>
          <div class="onboarding-interface-types">
            {#each availableDescriptors as descriptor (descriptor.type)}
              {@const configuredInterface = configuredInterfaces.find((item) => item.type === descriptor.type)}
              {#if configuredInterface}
                <button
                  type="button"
                  class="onboarding-interface-type configured"
                  aria-label={$t('onboarding.interface.edit', {
                    name: configuredInterface.name,
                    type: $t(descriptor.title),
                  })}
                  onclick={() => { openInterfaceEditor(descriptor.type, configuredInterface); }}
                >
                  <span class="interface-type-icon"><Icon name="check" size={19} /></span>
                  <span>
                    <strong>{configuredInterface.name} ({$t(descriptor.title)})</strong>
                    <small>{$t('onboarding.interface.saved')}</small>
                  </span>
                  <Icon name="edit" size={17} />
                </button>
              {:else}
                <button type="button" class="onboarding-interface-type" onclick={() => { openInterfaceEditor(descriptor.type); }}>
                  <span class="interface-type-icon"><Icon name={descriptor.icon} size={21} /></span>
                  <span>
                    <strong>{$t(descriptor.title)}</strong>
                    <small>{$t(descriptor.description)}</small>
                  </span>
                  <Icon name="arrow-right" size={17} />
                </button>
              {/if}
            {/each}
          </div>
          <p class="onboarding-interface-note">
            <span class="onboarding-interface-note-icon"><Icon name="info" size={16} /></span>
            <span>{$t('onboarding.interface.disabledCounts')}</span>
          </p>
          <div class="onboarding-actions">
            {#if configuredInterfaces.length === 0}
              <button class="button secondary" type="button" onclick={onskip}>{$t('onboarding.skip')}</button>
            {/if}
            <button
              class="button primary"
              type="button"
              disabled={configuredInterfaces.length === 0}
              onclick={() => { currentStep = 3; }}
            >
              {$t('onboarding.next')}
              <Icon name="arrow-right" size={17} />
            </button>
          </div>
        </div>
      {:else}
        <div class="onboarding-ready">
          <div class="onboarding-ready-body">
            <div class="onboarding-ready-mark" aria-hidden="true"><Icon name="check" size={32} /></div>
            <div class="onboarding-ready-copy">
              <h2>{$t('onboarding.ready.title')}</h2>
              <p>{$t('onboarding.ready.description')}</p>
            </div>
            <div class="onboarding-ready-summary">
              <div>
                <span><Icon name="check" size={15} /></span>
                <p><strong>{$t('onboarding.ready.identity')}</strong><small>{configuredDisplayName}</small></p>
              </div>
              <div>
                <span><Icon name="check" size={15} /></span>
                <p><strong>{$t('onboarding.ready.interface')}</strong><small>{$t('onboarding.ready.interfaceSaved')}</small></p>
              </div>
            </div>
          </div>
          <div class="onboarding-actions">
            <button class="button primary" type="button" onclick={oncomplete}>
              {$t('onboarding.ready.action')}
              <Icon name="arrow-right" size={17} />
            </button>
          </div>
        </div>
      {/if}
    </div>
  </section>
</main>

{#if editorType === 'websocket'}
  <WebSocketInterfaceEditor
    config={editorConfig?.type === 'websocket' ? editorConfig : undefined}
    oncancel={closeInterfaceEditor}
    onsave={saveInterface}
  />
{:else if editorType === 'rnode'}
  <RNodeInterfaceEditor
    config={editorConfig?.type === 'rnode' ? editorConfig : undefined}
    connections={interfaceCapabilities.rnodeConnections}
    oncancel={closeInterfaceEditor}
    onsave={saveInterface}
  />
{:else if editorType === 'tcp'}
  <TcpInterfaceEditor
    config={editorConfig?.type === 'tcp' ? editorConfig : undefined}
    oncancel={closeInterfaceEditor}
    onsave={saveInterface}
  />
{:else if editorType === 'udp'}
  <UdpInterfaceEditor
    config={editorConfig?.type === 'udp' ? editorConfig : undefined}
    oncancel={closeInterfaceEditor}
    onsave={saveInterface}
  />
{/if}

<style>
  .onboarding-page {
    display: grid;
    width: 100%;
    height: 100dvh;
    min-height: 0;
    place-items: center;
    padding: max(24px, env(safe-area-inset-top, 0px)) max(18px, env(safe-area-inset-right, 0px)) max(24px, env(safe-area-inset-bottom, 0px)) max(18px, env(safe-area-inset-left, 0px));
    overflow: auto;
    background:
      radial-gradient(circle at 50% -10%, rgba(101, 202, 109, .12), transparent 42%),
      var(--bg);
  }

  .onboarding-panel {
    width: min(760px, 100%);
    overflow: hidden;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-lg);
    background: var(--surface-1);
    box-shadow: var(--shadow);
  }

  .onboarding-header { padding: 34px 36px 26px; text-align: center; }
  .onboarding-header .eyebrow { margin-block-end: 10px !important; }
  .onboarding-header h1 { margin-block-end: 10px; }
  .onboarding-header > p:last-child { max-width: 510px; margin: 0 auto; font-size: .88rem; }
  .onboarding-mark { display: grid; width: 56px; height: 56px; margin: 0 auto 18px; place-items: center; border-radius: 16px; color: var(--accent); background: var(--accent-soft); }

  .onboarding-progress { position: relative; display: grid; grid-template-columns: max-content minmax(28px, 1fr) max-content minmax(28px, 1fr) max-content; align-items: start; margin: 0; padding: 0 36px 26px; list-style: none; }
  .onboarding-progress::before { position: absolute; z-index: 0; height: 1px; inset-block-start: 17px; inset-inline: 53px; content: ''; background: var(--border-strong); }
  .onboarding-progress li { position: relative; z-index: 1; display: grid; width: max-content; grid-template-columns: 34px max-content; align-items: start; gap: 10px; color: var(--text-subtle); background: var(--surface-1); }
  .onboarding-progress li:nth-child(1) { grid-column: 1; }
  .onboarding-progress li:nth-child(2) { grid-column: 3; }
  .onboarding-progress li:nth-child(3) { grid-column: 5; }
  .onboarding-progress li > span { z-index: 1; display: grid; width: 34px; height: 34px; place-items: center; border: 1px solid var(--border-strong); border-radius: 50%; background: var(--surface-1); font-size: .75rem; font-weight: 750; }
  .onboarding-progress li > div { z-index: 1; display: flex; min-width: 0; flex-direction: column; width: max-content; padding-inline-end: 8px; background: var(--surface-1); white-space: nowrap; }
  .onboarding-progress strong { font-size: .76rem; }
  .onboarding-progress small { margin-block-start: 2px; font-size: .66rem; }
  .onboarding-progress li.active, .onboarding-progress li.complete { color: var(--text); }
  .onboarding-progress li.active > span { border-color: var(--accent); color: var(--accent-ink); background: var(--accent); }
  .onboarding-progress li.complete > span { border-color: var(--accent); color: var(--accent-strong); background: var(--accent-soft); }

  .onboarding-content { min-height: 300px; padding: 28px 36px 34px; border-block-start: 1px solid var(--border); background: var(--surface-2); }
  .onboarding-step { display: flex; min-height: 238px; flex-direction: column; }
  .onboarding-step-copy { display: grid; grid-template-columns: 38px minmax(0, 1fr); align-items: start; gap: 13px; margin-block-end: 22px; }
  .onboarding-step-copy h2 { margin: 1px 0 5px; font-size: 1.05rem; }
  .onboarding-step-copy p { margin: 0; font-size: .78rem; }
  .onboarding-form { display: flex; flex: 1; flex-direction: column; gap: 16px; margin-inline: 51px 0; }
  .onboarding-actions { display: flex; justify-content: flex-end; gap: 9px; margin-block-start: auto; padding-block-start: 22px; }
  .onboarding-actions .button { min-width: 124px; }
  .onboarding-loading { display: grid; min-height: 230px; place-content: center; justify-items: center; gap: 12px; color: var(--text-muted); }
  .onboarding-loading p { margin: 0; font-size: .82rem; }

  .onboarding-interface-types { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; margin-inline-start: 51px; }
  .onboarding-interface-type { display: grid; min-width: 0; grid-template-columns: 38px minmax(0, 1fr) auto; align-items: center; gap: 11px; padding: 13px; border: 1px solid var(--border); border-radius: 11px; color: var(--text); background: var(--surface-1); text-align: start; }
  .onboarding-interface-type:hover { border-color: var(--border-strong); background: var(--surface-hover); }
  .onboarding-interface-type.configured { border-color: color-mix(in srgb, var(--accent) 35%, var(--border)); }
  .onboarding-interface-type.configured .interface-type-icon { color: var(--accent-strong); background: var(--accent-soft); }
  .onboarding-interface-type > span:nth-child(2) { display: flex; min-width: 0; flex-direction: column; }
  .onboarding-interface-type strong { font-size: .8rem; }
  .onboarding-interface-type small { margin-block-start: 3px; color: var(--text-subtle); font-size: .68rem; line-height: 1.35; }
  .onboarding-interface-note { display: flex; align-items: flex-start; gap: 8px; margin: 16px 2px 0 53px; color: var(--text-subtle); font-size: .7rem; line-height: 1.4; }
  .onboarding-interface-note-icon { display: grid; flex: none; width: 16px; height: 16px; place-items: center; }

  .onboarding-ready { display: flex; min-height: 238px; flex-direction: column; }
  .onboarding-ready-body { display: grid; justify-items: center; text-align: center; }
  .onboarding-ready-mark { display: grid; width: 64px; height: 64px; margin-block-end: 16px; place-items: center; border-radius: 50%; color: var(--accent-strong); background: var(--accent-soft); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 30%, transparent); }
  .onboarding-ready-copy h2 { margin-block-end: 7px; font-size: 1.18rem; }
  .onboarding-ready-copy p { max-width: 500px; margin: 0; font-size: .8rem; }
  .onboarding-ready-summary { display: grid; width: min(480px, 100%); grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 9px; margin-block: 22px; }
  .onboarding-ready-summary > div { display: grid; min-width: 0; grid-template-columns: 30px minmax(0, 1fr); align-items: center; gap: 9px; padding: 11px; border: 1px solid var(--border); border-radius: 10px; background: var(--surface-1); text-align: start; }
  .onboarding-ready-summary > div > span { display: grid; width: 30px; height: 30px; place-items: center; border-radius: 50%; color: var(--accent-strong); background: var(--accent-soft); }
  .onboarding-ready-summary p { display: flex; min-width: 0; flex-direction: column; margin: 0; }
  .onboarding-ready-summary strong { font-size: .75rem; }
  .onboarding-ready-summary small { overflow: hidden; margin-block-start: 2px; color: var(--text-subtle); font-size: .66rem; text-overflow: ellipsis; white-space: nowrap; }

  @media (max-width: 760px) {
    .onboarding-progress { grid-template-columns: repeat(3, minmax(0, 1fr)); }
    .onboarding-progress::before { inset-block-start: 15px; inset-inline: calc(16.6667% + 24px); }
    .onboarding-progress li,
    .onboarding-progress li:nth-child(1),
    .onboarding-progress li:nth-child(2),
    .onboarding-progress li:nth-child(3) {
      width: auto;
      grid-column: auto;
      grid-template-columns: minmax(0, 1fr);
      justify-items: center;
      gap: 6px;
      background: transparent;
      text-align: center;
    }
    .onboarding-progress li > div { width: auto; max-width: 100%; padding-inline: 5px; white-space: normal; }
    .onboarding-progress small { display: none; }
  }

  @media (max-width: 600px) {
    .onboarding-page { align-items: safe center; justify-items: center; padding-inline: 12px; }
    .onboarding-header { padding: 26px 20px 22px; }
    .onboarding-header > p:last-child { font-size: .8rem; }
    .onboarding-progress { padding: 0 20px 22px; }
    .onboarding-progress::before { inset-inline: calc(16.6667% + 13.333px); }
    .onboarding-progress li { gap: 6px; }
    .onboarding-progress li > span { width: 30px; height: 30px; }
    .onboarding-progress li > div { padding-inline-end: 5px; }
    .onboarding-content { min-height: 0; padding: 24px 18px 26px; }
    .onboarding-step { min-height: 0; }
    .onboarding-form { margin-inline: 0; }
    .onboarding-interface-types { grid-template-columns: 1fr; margin-inline-start: 0; }
    .onboarding-interface-note { margin-inline-start: 2px; }
    .onboarding-actions { display: grid; grid-template-columns: minmax(0, 1fr); margin-block-start: 22px; padding-block-start: 0; }
    .onboarding-actions .button { width: 100%; min-width: 0; }
    .onboarding-ready-summary { grid-template-columns: 1fr; }
  }

  @media (max-width: 600px) and (max-height: 700px) {
    .onboarding-header { padding-block: 20px 18px; }
    .onboarding-mark, .onboarding-header .eyebrow { display: none; }
  }
</style>
