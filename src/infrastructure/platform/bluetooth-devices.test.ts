import { afterEach, describe, expect, it, vi } from 'vitest';
import { rememberBluetoothDevice, resolveBluetoothDevice } from './bluetooth-devices';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('selected Bluetooth devices', () => {
  it('reuses the exact device returned by requestDevice for the first connection', async () => {
    const device = Object.assign(new EventTarget(), { id: 'selected-rnode', name: 'RNode Test' }) as BluetoothDevice;
    rememberBluetoothDevice(device);

    await expect(resolveBluetoothDevice(device.id)).resolves.toEqual({
      device,
      source: 'selection',
    });
  });

  it('caches a device recovered from browser authorization for later reconnects', async () => {
    const device = Object.assign(new EventTarget(), { id: 'authorized-rnode', name: 'RNode Authorized' }) as BluetoothDevice;
    const getDevices = vi.fn().mockResolvedValue([device]);
    vi.stubGlobal('navigator', { bluetooth: { getDevices } });

    await expect(resolveBluetoothDevice(device.id)).resolves.toEqual({
      device,
      source: 'authorization',
    });
    getDevices.mockResolvedValue([]);
    await expect(resolveBluetoothDevice(device.id)).resolves.toEqual({
      device,
      source: 'selection',
    });
    expect(getDevices).toHaveBeenCalledTimes(1);
  });
});
