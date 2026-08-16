import { get } from 'svelte/store';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  answerDesktopBluetoothSelection,
  desktopBluetoothSelection,
  selectDesktopBluetoothDevice,
} from './desktop-bluetooth-selection';

describe('desktop Bluetooth selection', () => {
  afterEach(() => {
    window.retivumDesktopBluetooth = undefined;
    desktopBluetoothSelection.set(undefined);
  });

  it('collects native scan results and returns a persistent identifier', async () => {
    let listener: ((event: DesktopBluetoothEvent) => void) | undefined;
    window.retivumDesktopBluetooth = {
      startScan: vi.fn().mockResolvedValue(undefined),
      stopScan: vi.fn().mockResolvedValue(undefined),
      pair: vi.fn(),
      connectedDevices: vi.fn().mockResolvedValue([]),
      open: vi.fn(),
      write: vi.fn(),
      close: vi.fn(),
      onEvent: vi.fn((next) => {
        listener = next;
        return () => { listener = undefined; };
      }),
    };

    const selected = selectDesktopBluetoothDevice();
    listener?.({
      type: 'device',
      device: { id: 'native-rnode', name: 'RNode Field', detail: '-48 dBm' },
    });
    expect(get(desktopBluetoothSelection)?.devices).toEqual([
      { id: 'native-rnode', name: 'RNode Field', detail: '-48 dBm' },
    ]);
    await answerDesktopBluetoothSelection('native-rnode');

    await expect(selected).resolves.toEqual({
      deviceId: 'native-rnode',
      deviceName: 'RNode Field',
    });
    expect(window.retivumDesktopBluetooth.stopScan).toHaveBeenCalled();
  });

  it('stops scanning and reports user cancellation', async () => {
    window.retivumDesktopBluetooth = {
      startScan: vi.fn().mockResolvedValue(undefined),
      stopScan: vi.fn().mockResolvedValue(undefined),
      pair: vi.fn(),
      connectedDevices: vi.fn().mockResolvedValue([]),
      open: vi.fn(),
      write: vi.fn(),
      close: vi.fn(),
      onEvent: vi.fn(() => () => undefined),
    };
    const selected = selectDesktopBluetoothDevice();
    await answerDesktopBluetoothSelection();
    await expect(selected).rejects.toThrow('RNODE_BLE_SELECTION_CANCELLED');
  });
});
