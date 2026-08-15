import { get, writable } from 'svelte/store';

export const desktopDeviceSelection = writable<DesktopDeviceSelectionRequest | undefined>();
export const desktopBluetoothPairing = writable<DesktopBluetoothPairingRequest | undefined>();
const completedDeviceSelections = new Map<DesktopDeviceSelectionRequest['type'], DesktopDeviceSelectionRequest['devices'][number]>();

export function initializeDesktopDeviceSelection(): () => void {
  const bridge = window.retivumDesktopDevices;
  if (!bridge) return () => undefined;
  const stopSelection = bridge.onSelectionRequest((request) => {
    completedDeviceSelections.delete(request.type);
    desktopDeviceSelection.set(request);
  });
  const stopPairing = bridge.onPairingRequest((request) => desktopBluetoothPairing.set(request));
  return () => {
    stopSelection();
    stopPairing();
  };
}

export async function answerDesktopDeviceSelection(requestId: string, deviceId?: string): Promise<void> {
  const request = get(desktopDeviceSelection);
  const selected = request?.requestId === requestId
    ? request.devices.find((device) => device.id === deviceId)
    : undefined;
  if (selected && request) completedDeviceSelections.set(request.type, selected);
  desktopDeviceSelection.set(undefined);
  try {
    await window.retivumDesktopDevices?.respond({ requestId, deviceId });
  } catch (error) {
    if (selected && completedDeviceSelections.get(request!.type) === selected) {
      completedDeviceSelections.delete(request!.type);
    }
    throw error;
  }
}

export function takeDesktopDeviceSelection(
  type: DesktopDeviceSelectionRequest['type'],
): DesktopDeviceSelectionRequest['devices'][number] | undefined {
  const selected = completedDeviceSelections.get(type);
  completedDeviceSelections.delete(type);
  return selected;
}

export async function answerDesktopBluetoothPairing(
  requestId: string,
  confirmed: boolean,
  pin?: string,
): Promise<void> {
  desktopBluetoothPairing.set(undefined);
  await window.retivumDesktopDevices?.respondPairing({ requestId, confirmed, pin });
}
