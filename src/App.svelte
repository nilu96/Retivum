<script lang="ts">
  import { onMount } from 'svelte';
  import { navigateTopLevel, route, startRouter } from './app/router';
  import AppShell from './lib/layout/AppShell.svelte';
  import ChatView from './features/chat/ChatView.svelte';
  import NomadNetView from './features/nomadnet/NomadNetView.svelte';
  import ToolsView from './features/tools/ToolsView.svelte';
  import SettingsView from './features/settings/SettingsView.svelte';
  import ReticulumLogsView from './features/settings/ReticulumLogsView.svelte';
  import ProvisioningView from './features/provisioning/ProvisioningView.svelte';
  import StatusDetailsView from './features/tools/StatusDetailsView.svelte';
  import RNodeMaintenanceView from './features/tools/RNodeMaintenanceView.svelte';
  import OnboardingView from './features/onboarding/OnboardingView.svelte';
  import {
    determineOnboardingPlan,
    type OnboardingPlan,
  } from './features/onboarding/onboarding';
  import ProbeView from './features/tools/ProbeView.svelte';
  import PathManagementView from './features/tools/PathManagementView.svelte';
  import DestinationHashView from './features/tools/DestinationHashView.svelte';
  import NetworkVisualizerView from './features/tools/NetworkVisualizerView.svelte';
  import DevicePicker from './lib/components/DevicePicker.svelte';
  import DesktopBluetoothPairing from './lib/components/DesktopBluetoothPairing.svelte';
  import ToastViewport from './lib/components/ToastViewport.svelte';
  import {
    answerDesktopBluetoothPairing,
    answerDesktopDeviceSelection,
    desktopBluetoothPairing,
    desktopDeviceSelection,
    initializeDesktopDeviceSelection,
  } from './infrastructure/platform/desktop-device-selection';
  import { answerNativeBluetoothSelection, nativeBluetoothSelection } from './infrastructure/platform/native-bluetooth-selection';
  import {
    answerDesktopBluetoothSelection,
    desktopBluetoothSelection,
  } from './infrastructure/platform/desktop-bluetooth-selection';
  import {
    identities,
    interfaceConfigurations,
    reticulumRuntime,
    runtimeErrorCode,
    runtimeStatus,
  } from './infrastructure/reticulum/runtime';
  import { t } from './i18n';
  import { toast } from './lib/notifications/toasts';

  let observedRuntimeErrorCode: string | undefined;
  let activeOnboardingPlan = $state<OnboardingPlan>();
  let onboardingEvaluated = $state(false);

  $effect(() => {
    // Onboarding is a startup decision. Configuration changes during this app
    // session must not make the dialog appear unexpectedly.
    if (onboardingEvaluated) return;
    const runtimeReady = $runtimeStatus !== 'starting' && $runtimeStatus !== 'error';
    if (!runtimeReady) return;
    onboardingEvaluated = true;
    activeOnboardingPlan = determineOnboardingPlan($identities, $interfaceConfigurations);
  });

  $effect(() => {
    const errorCode = $runtimeErrorCode;
    if (!errorCode) {
      observedRuntimeErrorCode = undefined;
      return;
    }
    if (errorCode === observedRuntimeErrorCode) return;
    observedRuntimeErrorCode = errorCode;
    toast.error('runtime.error.generic');
  });

  onMount(() => {
    const stopRouter = startRouter();
    const stopDeviceSelection = initializeDesktopDeviceSelection();
    void reticulumRuntime.start();
    return () => {
      stopRouter();
      stopDeviceSelection();
      reticulumRuntime.stop();
    };
  });
</script>

{#if activeOnboardingPlan}
  <OnboardingView
    initialStep={activeOnboardingPlan.initialStep}
    interfaceStepRequired={activeOnboardingPlan.interfaceStepRequired}
    onskip={() => {
      activeOnboardingPlan = undefined;
    }}
    oncomplete={() => {
      activeOnboardingPlan = undefined;
      navigateTopLevel('chat');
    }}
  />
{:else}
  <AppShell current={$route}>
    {#if $route === 'chat'}
      <ChatView />
    {:else if $route === 'logs'}
      <ReticulumLogsView />
    {:else if $route === 'settings'}
      <SettingsView />
    {:else if $route === 'tools'}
      <ToolsView />
    {:else if $route === 'provisioning'}
      <ProvisioningView />
    {:else if $route === 'rnode-maintenance'}
      <RNodeMaintenanceView />
    {:else if $route === 'probe'}
      <ProbeView />
    {:else if $route === 'path-management'}
      <PathManagementView />
    {:else if $route === 'destination-hash'}
      <DestinationHashView />
    {:else if $route === 'network-visualizer'}
      <NetworkVisualizerView />
    {:else if $route === 'status'}
      <StatusDetailsView />
    {/if}
    <div class="persistent-route-view" hidden={$route !== 'nomadnet'}>
      <NomadNetView active={$route === 'nomadnet'} />
    </div>
  </AppShell>
{/if}

{#if $desktopDeviceSelection}
  <DevicePicker
    request={$desktopDeviceSelection}
    titleKey={`desktop.device.${$desktopDeviceSelection.type}.title`}
    descriptionKey="desktop.device.description"
    onselect={(deviceId) => void answerDesktopDeviceSelection($desktopDeviceSelection!.requestId, deviceId)}
  />
{/if}

{#if $nativeBluetoothSelection}
  <DevicePicker
    request={$nativeBluetoothSelection}
    titleKey="desktop.device.ble.title"
    descriptionKey="native.bluetooth.device.description"
    statusKey={$nativeBluetoothSelection.scanning
      ? 'native.bluetooth.device.scanning'
      : 'native.bluetooth.device.empty'}
    onselect={(deviceId) => void answerNativeBluetoothSelection($nativeBluetoothSelection!.requestId, deviceId)}
  />
{/if}

{#if $desktopBluetoothSelection}
  <DevicePicker
    request={$desktopBluetoothSelection}
    titleKey="desktop.device.ble.title"
    descriptionKey="desktop.bluetooth.device.description"
    statusKey={$desktopBluetoothSelection.scanning
      ? 'native.bluetooth.device.scanning'
      : 'native.bluetooth.device.empty'}
    onselect={(deviceId) => void answerDesktopBluetoothSelection(deviceId)}
  />
{/if}

{#if $desktopBluetoothPairing}
  <DesktopBluetoothPairing
    request={$desktopBluetoothPairing}
    onrespond={(confirmed, pin) => void answerDesktopBluetoothPairing($desktopBluetoothPairing!.requestId, confirmed, pin)}
  />
{/if}

<ToastViewport />
