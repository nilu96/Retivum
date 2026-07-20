import { Capacitor } from '@capacitor/core';
import type { InterfaceConfig, InterfaceType, RNodeConnectionType } from '../../domain/settings';
import { authorizeNativeRNodeDevice } from './byte-connections';
import { rememberBluetoothDevice } from './bluetooth-devices';
import { selectNativeRNodeDevice } from './native-bluetooth-selection';

export interface InterfaceCapabilities {
  websocket: true;
  rnodeConnections: RNodeConnectionType[];
  tcp: boolean;
  udp: boolean;
}

export function detectInterfaceCapabilities(
  environment: {
    native: boolean;
    bluetooth: boolean;
    serial: boolean;
    socketBridge: boolean;
    datagramBridge: boolean;
  } = {
    native: Capacitor.isNativePlatform(),
    bluetooth: typeof navigator !== 'undefined' && navigator.bluetooth !== undefined,
    serial: typeof navigator !== 'undefined' && navigator.serial !== undefined,
    socketBridge: typeof window !== 'undefined'
      && (window.retivumDesktopSockets !== undefined || window.retivumMobileSockets !== undefined),
    datagramBridge: typeof window !== 'undefined' && window.retivumDesktopUdpSockets !== undefined,
  },
): InterfaceCapabilities {
  const rnodeConnections: RNodeConnectionType[] = [];
  if (environment.native || environment.bluetooth) rnodeConnections.push('ble');
  if (!environment.native && environment.serial) rnodeConnections.push('serial');
  return {
    websocket: true,
    rnodeConnections,
    tcp: environment.native || environment.socketBridge,
    udp: environment.native || environment.datagramBridge,
  };
}

export function supportedInterfaceTypes(capabilities = detectInterfaceCapabilities()): InterfaceType[] {
  return [
    'websocket',
    ...(capabilities.rnodeConnections.length > 0 ? ['rnode' as const] : []),
    ...(capabilities.tcp ? ['tcp' as const] : []),
    ...(capabilities.udp ? ['udp' as const] : []),
  ];
}

export function interfaceIsSupported(config: InterfaceConfig, capabilities = detectInterfaceCapabilities()): boolean {
  if (config.type === 'websocket') return true;
  if (config.type === 'tcp') return capabilities.tcp;
  if (config.type === 'udp') return capabilities.udp;
  return capabilities.rnodeConnections.includes(config.connection.type);
}

export async function selectRNodeDevice(type: RNodeConnectionType): Promise<{
  deviceId?: string;
  deviceName: string;
  usbVendorId?: number;
  usbProductId?: number;
}> {
  if (type === 'ble') {
    if (Capacitor.isNativePlatform()) {
      const device = await selectNativeRNodeDevice();
      return { deviceId: device.deviceId, deviceName: device.name ?? 'RNode' };
    }
    if (!navigator.bluetooth) throw new Error('RNODE_BLE_UNAVAILABLE');
    const device = await navigator.bluetooth.requestDevice({
      filters: [{ services: ['6e400001-b5a3-f393-e0a9-e50e24dcca9e'] }],
      optionalServices: ['6e400001-b5a3-f393-e0a9-e50e24dcca9e'],
    });
    rememberBluetoothDevice(device);
    return { deviceId: device.id, deviceName: device.name ?? 'RNode' };
  }
  if (!navigator.serial) throw new Error('RNODE_SERIAL_UNAVAILABLE');
  const port = await navigator.serial.requestPort();
  const info = port.getInfo();
  const identifier = [info.usbVendorId, info.usbProductId]
    .filter((value) => value !== undefined)
    .map((value) => value!.toString(16).padStart(4, '0'))
    .join(':');
  return {
    deviceId: identifier || 'authorized-serial-port',
    deviceName: identifier ? `USB ${identifier}` : 'Authorized serial port',
    usbVendorId: info.usbVendorId,
    usbProductId: info.usbProductId,
  };
}

export async function authorizeRNodeDevice(type: RNodeConnectionType, deviceId?: string): Promise<void> {
  if (type === 'ble' && deviceId && Capacitor.isNativePlatform()) {
    await authorizeNativeRNodeDevice(deviceId);
  }
}
