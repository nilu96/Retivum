import { writable } from 'svelte/store';

export interface DesktopBluetoothSelectionRequest {
  devices: Array<{ id: string; name: string; detail?: string }>;
  scanning: boolean;
}

interface PendingSelection {
  devices: Map<string, { id: string; name: string; detail?: string }>;
  resolve: (device: { deviceId: string; deviceName: string }) => void;
  reject: (error: Error) => void;
  stopEvents: () => void;
}

export const desktopBluetoothSelection = writable<DesktopBluetoothSelectionRequest | undefined>();
let pending: PendingSelection | undefined;

export async function selectDesktopBluetoothDevice(): Promise<{
  deviceId: string;
  deviceName: string;
}> {
  const bridge = window.retivumDesktopBluetooth;
  if (!bridge) throw new Error('RNODE_BLE_UNAVAILABLE');
  if (pending) throw new Error('RNODE_BLE_SCAN_BUSY');

  return new Promise((resolve, reject) => {
    const devices = new Map<string, { id: string; name: string; detail?: string }>();
    const stopEvents = bridge.onEvent((event) => {
      if (event.type !== 'device' || !event.device) return;
      devices.set(event.device.id, event.device);
      desktopBluetoothSelection.set({ devices: Array.from(devices.values()), scanning: true });
    });
    pending = { devices, resolve, reject, stopEvents };
    desktopBluetoothSelection.set({ devices: [], scanning: true });
    void bridge.startScan().catch((error) => finish(undefined, error));
  });
}

export async function answerDesktopBluetoothSelection(deviceId?: string): Promise<void> {
  const selected = deviceId ? pending?.devices.get(deviceId) : undefined;
  if (deviceId && !selected) return;
  await finish(selected);
}

async function finish(
  selected?: { id: string; name: string },
  error?: unknown,
): Promise<void> {
  const current = pending;
  if (!current) return;
  pending = undefined;
  current.stopEvents();
  desktopBluetoothSelection.set(undefined);
  await window.retivumDesktopBluetooth?.stopScan().catch(() => undefined);
  if (error) {
    const message = error instanceof Error ? error.message : String(error);
    current.reject(new Error(message.match(/RNODE_[A-Z0-9_]+/)?.[0] ?? 'RNODE_BLE_UNAVAILABLE'));
  } else if (selected) {
    current.resolve({
      deviceId: selected.id,
      deviceName: selected.name,
    });
  } else {
    current.reject(new Error('RNODE_BLE_SELECTION_CANCELLED'));
  }
}
