import { get } from 'svelte/store';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScanResult } from '@capacitor-community/bluetooth-le';

const mocks = vi.hoisted(() => ({
  initializeNativeBluetooth: vi.fn(),
  isEnabled: vi.fn(),
  requestLEScan: vi.fn(),
  stopLEScan: vi.fn(),
}));

vi.mock('./native-bluetooth', () => ({
  initializeNativeBluetooth: mocks.initializeNativeBluetooth,
}));

vi.mock('@capacitor-community/bluetooth-le', () => ({
  BleClient: {
    isEnabled: mocks.isEnabled,
    requestLEScan: mocks.requestLEScan,
    stopLEScan: mocks.stopLEScan,
  },
}));

describe('native Bluetooth device selection', () => {
  beforeEach(() => {
    mocks.initializeNativeBluetooth.mockReset().mockResolvedValue(undefined);
    mocks.isEnabled.mockReset().mockResolvedValue(true);
    mocks.requestLEScan.mockReset().mockResolvedValue(undefined);
    mocks.stopLEScan.mockReset().mockResolvedValue(undefined);
  });

  it('publishes community-plugin scan results and returns the selected device', async () => {
    let onScanResult: ((result: ScanResult) => void) | undefined;
    mocks.requestLEScan.mockImplementation(async (_options, callback) => {
      onScanResult = callback;
    });
    const {
      answerNativeBluetoothSelection,
      nativeBluetoothSelection,
      selectNativeRNodeDevice,
    } = await import('./native-bluetooth-selection');

    const selected = selectNativeRNodeDevice();
    await vi.waitFor(() => expect(mocks.requestLEScan).toHaveBeenCalled());
    onScanResult?.({
      device: { deviceId: 'rnode-1', name: 'Cached name' },
      localName: 'RNode',
      rssi: -52,
    });

    const request = get(nativeBluetoothSelection);
    expect(request?.devices).toEqual([{ id: 'rnode-1', name: 'RNode', detail: '-52 dBm' }]);
    await answerNativeBluetoothSelection(request!.requestId, 'rnode-1');

    await expect(selected).resolves.toEqual({ deviceId: 'rnode-1', name: 'Cached name' });
    expect(mocks.requestLEScan).toHaveBeenCalledWith({
      services: ['6e400001-b5a3-f393-e0a9-e50e24dcca9e'],
      allowDuplicates: false,
    }, expect.any(Function));
    expect(mocks.stopLEScan).toHaveBeenCalledTimes(1);
    expect(get(nativeBluetoothSelection)).toBeUndefined();
  });
});
