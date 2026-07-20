<script lang="ts">
  import { onMount } from 'svelte';
  import { route, startRouter } from './app/router';
  import AppShell from './lib/layout/AppShell.svelte';
  import ChatView from './features/chat/ChatView.svelte';
  import NomadNetView from './features/nomadnet/NomadNetView.svelte';
  import SettingsView from './features/settings/SettingsView.svelte';
  import ReticulumLogsView from './features/settings/ReticulumLogsView.svelte';
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
  import { reticulumRuntime, runtimeErrorCode } from './infrastructure/reticulum/runtime';
  import { toast } from './lib/notifications/toasts';

  let observedRuntimeErrorCode: string | undefined;

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

<AppShell current={$route}>
  {#if $route === 'chat'}
    <ChatView />
  {:else if $route === 'logs'}
    <ReticulumLogsView />
  {:else if $route === 'settings'}
    <SettingsView />
  {/if}
  <div class="persistent-route-view" hidden={$route !== 'nomadnet'}>
    <NomadNetView />
  </div>
</AppShell>

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

{#if $desktopBluetoothPairing}
  <DesktopBluetoothPairing
    request={$desktopBluetoothPairing}
    onrespond={(confirmed, pin) => void answerDesktopBluetoothPairing($desktopBluetoothPairing!.requestId, confirmed, pin)}
  />
{/if}

<ToastViewport />
