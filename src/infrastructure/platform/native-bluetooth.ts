import { Capacitor } from '@capacitor/core';
import { BleClient } from '@capacitor-community/bluetooth-le';

let initialization: Promise<void> | undefined;

export function initializeNativeBluetooth(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return Promise.resolve();
  initialization ??= BleClient.initialize({ androidNeverForLocation: true }).catch((error) => {
    initialization = undefined;
    const message = error instanceof Error ? error.message : String(error);
    if (/permission|denied|unauthorized/i.test(message)) throw new Error('RNODE_BLE_PERMISSION_DENIED');
    if (/unsupported|not supported/i.test(message)) throw new Error('RNODE_BLE_UNAVAILABLE');
    throw error;
  });
  return initialization;
}

export async function prepareNativeBluetoothDevice(deviceId: string): Promise<void> {
  const devices = await BleClient.getDevices([deviceId]);
  if (!devices.some((device) => device.deviceId === deviceId)) throw new Error('RNODE_BLE_DEVICE_NOT_FOUND');
}
