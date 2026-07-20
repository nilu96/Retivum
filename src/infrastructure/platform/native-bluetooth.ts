import { Capacitor } from '@capacitor/core';
import { BluetoothLowEnergy } from '@capgo/capacitor-bluetooth-low-energy';

let initialization: Promise<void> | undefined;
const discoveredDeviceIds = new Set<string>();

export function initializeNativeBluetooth(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return Promise.resolve();
  initialization ??= BluetoothLowEnergy.initialize({ mode: 'central' }).catch((error) => {
    initialization = undefined;
    throw error;
  });
  return initialization;
}

export function rememberNativeBluetoothDevice(deviceId: string): void {
  discoveredDeviceIds.add(deviceId);
}

export function nativeBluetoothDeviceIsDiscovered(deviceId: string): boolean {
  return discoveredDeviceIds.has(deviceId);
}
