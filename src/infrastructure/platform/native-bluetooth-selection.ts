import { BluetoothLowEnergy, type BleDevice } from '@capgo/capacitor-bluetooth-low-energy';
import { Capacitor, type PluginListenerHandle } from '@capacitor/core';
import { writable } from 'svelte/store';
import { initializeNativeBluetooth, rememberNativeBluetoothDevice } from './native-bluetooth';

const RNODE_NUS_SERVICE = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
const SCAN_TIMEOUT_MS = 30_000;

export interface NativeBluetoothSelectionRequest {
  requestId: string;
  devices: Array<{ id: string; name: string; detail?: string }>;
  scanning: boolean;
}

interface PendingSelection {
  requestId: string;
  devices: Map<string, BleDevice>;
  resolve: (device: BleDevice) => void;
  reject: (error: Error) => void;
  listener?: PluginListenerHandle;
  timeout?: ReturnType<typeof setTimeout>;
}

export const nativeBluetoothSelection = writable<NativeBluetoothSelectionRequest | undefined>();
let pending: PendingSelection | undefined;

export async function selectNativeRNodeDevice(): Promise<BleDevice> {
  if (pending) throw new Error('RNODE_BLE_SELECTION_IN_PROGRESS');
  await initializeNativeBluetooth();
  const permissions = await BluetoothLowEnergy.requestPermissions();
  if (permissions.bluetooth === 'denied'
    || (Capacitor.getPlatform() === 'android' && permissions.location === 'denied')) {
    throw new Error('RNODE_BLE_PERMISSION_DENIED');
  }
  if (!(await BluetoothLowEnergy.isAvailable()).available) throw new Error('RNODE_BLE_UNAVAILABLE');
  if (!(await waitForBluetoothEnabled())) throw new Error('RNODE_BLE_DISABLED');

  const requestId = crypto.randomUUID();
  const result = new Promise<BleDevice>((resolve, reject) => {
    pending = { requestId, devices: new Map(), resolve, reject };
  });
  nativeBluetoothSelection.set({ requestId, devices: [], scanning: true });

  try {
    pending!.listener = await BluetoothLowEnergy.addListener('deviceScanned', ({ device }) => {
      if (!pending || pending.requestId !== requestId) return;
      rememberNativeBluetoothDevice(device.deviceId);
      pending.devices.set(device.deviceId, device);
      publish(pending, true);
    });
    await BluetoothLowEnergy.startScan({
      services: [RNODE_NUS_SERVICE],
      timeout: SCAN_TIMEOUT_MS,
      allowDuplicates: false,
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
  const device = deviceId ? current.devices.get(deviceId) : undefined;
  await finishSelection();
  if (device) current.resolve(device);
  else current.reject(new Error('RNODE_BLE_SELECTION_CANCELLED'));
}

function publish(selection: PendingSelection, scanning: boolean): void {
  nativeBluetoothSelection.set({
    requestId: selection.requestId,
    scanning,
    devices: Array.from(selection.devices.values(), (device) => ({
      id: device.deviceId,
      name: device.name || 'RNode',
      detail: typeof device.rssi === 'number' ? `${device.rssi} dBm` : undefined,
    })),
  });
}

async function finishSelection(): Promise<void> {
  const current = pending;
  pending = undefined;
  nativeBluetoothSelection.set(undefined);
  if (!current) return;
  if (current.timeout) clearTimeout(current.timeout);
  await BluetoothLowEnergy.stopScan().catch(() => undefined);
  await current.listener?.remove().catch(() => undefined);
}

async function waitForBluetoothEnabled(): Promise<boolean> {
  const deadline = Date.now() + 3_000;
  do {
    if ((await BluetoothLowEnergy.isEnabled()).enabled) return true;
    await new Promise((resolve) => setTimeout(resolve, 150));
  } while (Date.now() < deadline);
  return false;
}
