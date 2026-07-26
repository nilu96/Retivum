import { BleClient, type BleDevice, type ScanResult } from '@capacitor-community/bluetooth-le';
import { writable } from 'svelte/store';
import { initializeNativeBluetooth } from './native-bluetooth';

const RNODE_NUS_SERVICE = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
const SCAN_TIMEOUT_MS = 30_000;

export interface NativeBluetoothSelectionRequest {
  requestId: string;
  devices: Array<{ id: string; name: string; detail?: string }>;
  scanning: boolean;
}

interface PendingSelection {
  requestId: string;
  devices: Map<string, ScanResult>;
  resolve: (device: BleDevice) => void;
  reject: (error: Error) => void;
  timeout?: ReturnType<typeof setTimeout>;
}

export const nativeBluetoothSelection = writable<NativeBluetoothSelectionRequest | undefined>();
let pending: PendingSelection | undefined;

export async function selectNativeRNodeDevice(): Promise<BleDevice> {
  if (pending) throw new Error('RNODE_BLE_SELECTION_IN_PROGRESS');
  await initializeNativeBluetooth();
  if (!await waitForBluetoothEnabled()) throw new Error('RNODE_BLE_DISABLED');

  const requestId = crypto.randomUUID();
  const result = new Promise<BleDevice>((resolve, reject) => {
    pending = { requestId, devices: new Map(), resolve, reject };
  });
  nativeBluetoothSelection.set({ requestId, devices: [], scanning: true });

  try {
    await BleClient.requestLEScan({
      services: [RNODE_NUS_SERVICE],
      allowDuplicates: false,
    }, (scanResult) => {
      if (!pending || pending.requestId !== requestId) return;
      pending.devices.set(scanResult.device.deviceId, scanResult);
      publish(pending, true);
    });
    pending!.timeout = setTimeout(() => {
      if (!pending || pending.requestId !== requestId) return;
      publish(pending, false);
    }, SCAN_TIMEOUT_MS);
  } catch (error) {
    await finishSelection();
    throw error;
  }

  return result;
}

export async function answerNativeBluetoothSelection(requestId: string, deviceId?: string): Promise<void> {
  if (!pending || pending.requestId !== requestId) return;
  const current = pending;
  const device = deviceId ? current.devices.get(deviceId)?.device : undefined;
  await finishSelection();
  if (device) current.resolve(device);
  else current.reject(new Error('RNODE_BLE_SELECTION_CANCELLED'));
}

function publish(selection: PendingSelection, scanning: boolean): void {
  nativeBluetoothSelection.set({
    requestId: selection.requestId,
    scanning,
    devices: Array.from(selection.devices.values(), (result) => ({
      id: result.device.deviceId,
      name: result.localName || result.device.name || 'RNode',
      detail: typeof result.rssi === 'number' ? `${result.rssi} dBm` : undefined,
    })),
  });
}

async function finishSelection(): Promise<void> {
  const current = pending;
  pending = undefined;
  nativeBluetoothSelection.set(undefined);
  if (!current) return;
  if (current.timeout) clearTimeout(current.timeout);
  await BleClient.stopLEScan().catch(() => undefined);
}

async function waitForBluetoothEnabled(): Promise<boolean> {
  const deadline = Date.now() + 3_000;
  do {
    if (await BleClient.isEnabled()) return true;
    await new Promise((resolve) => setTimeout(resolve, 150));
  } while (Date.now() < deadline);
  return false;
}
