import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  initialize: vi.fn(),
  getDevices: vi.fn(),
  isNativePlatform: vi.fn(() => true),
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: mocks.isNativePlatform,
  },
}));

vi.mock('@capacitor-community/bluetooth-le', () => ({
  BleClient: {
    initialize: mocks.initialize,
    getDevices: mocks.getDevices,
  },
}));

describe('native Bluetooth initialization', () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.initialize.mockReset().mockResolvedValue(undefined);
    mocks.getDevices.mockReset();
    mocks.isNativePlatform.mockReturnValue(true);
  });

  it('initializes without Android location derivation and reuses the initialization', async () => {
    const { initializeNativeBluetooth } = await import('./native-bluetooth');

    await Promise.all([initializeNativeBluetooth(), initializeNativeBluetooth()]);

    expect(mocks.initialize).toHaveBeenCalledTimes(1);
    expect(mocks.initialize).toHaveBeenCalledWith({ androidNeverForLocation: true });
  });

  it.each([
    ['Permission denied.', 'RNODE_BLE_PERMISSION_DENIED'],
    ['BLE unsupported', 'RNODE_BLE_UNAVAILABLE'],
  ])('normalizes initialization failure %s', async (message, expected) => {
    mocks.initialize.mockRejectedValueOnce(new Error(message));
    const { initializeNativeBluetooth } = await import('./native-bluetooth');

    await expect(initializeNativeBluetooth()).rejects.toThrow(expected);
  });

  it('restores a saved native device through the plugin device registry', async () => {
    mocks.getDevices.mockResolvedValue([{ deviceId: 'saved-device', name: 'RNode' }]);
    const { prepareNativeBluetoothDevice } = await import('./native-bluetooth');

    await prepareNativeBluetoothDevice('saved-device');

    expect(mocks.getDevices).toHaveBeenCalledWith(['saved-device']);
  });

  it('rejects a saved device that the native platform cannot restore', async () => {
    mocks.getDevices.mockResolvedValue([]);
    const { prepareNativeBluetoothDevice } = await import('./native-bluetooth');

    await expect(prepareNativeBluetoothDevice('missing-device')).rejects.toThrow('RNODE_BLE_DEVICE_NOT_FOUND');
  });
});
