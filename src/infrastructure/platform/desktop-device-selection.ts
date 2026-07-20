import { writable } from 'svelte/store';

export const desktopDeviceSelection = writable<DesktopDeviceSelectionRequest | undefined>();
export const desktopBluetoothPairing = writable<DesktopBluetoothPairingRequest | undefined>();

export function initializeDesktopDeviceSelection(): () => void {
  const bridge = window.retivumDesktopDevices;
  if (!bridge) return () => undefined;
  const stopSelection = bridge.onSelectionRequest((request) => desktopDeviceSelection.set(request));
  const stopPairing = bridge.onPairingRequest((request) => desktopBluetoothPairing.set(request));
  return () => {
    stopSelection();
    stopPairing();
  };
}

export async function answerDesktopDeviceSelection(requestId: string, deviceId?: string): Promise<void> {
  desktopDeviceSelection.set(undefined);
  await window.retivumDesktopDevices?.respond({ requestId, deviceId });
}

export async function answerDesktopBluetoothPairing(
  requestId: string,
  confirmed: boolean,
  pin?: string,
): Promise<void> {
  desktopBluetoothPairing.set(undefined);
  await window.retivumDesktopDevices?.respondPairing({ requestId, confirmed, pin });
}
