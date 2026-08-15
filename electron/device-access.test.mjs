import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  systemPreferences: {
    askForMediaAccess: vi.fn(),
    getMediaAccessStatus: vi.fn(() => 'granted'),
  },
}));

vi.mock('./serial-device-enumeration.mjs', () => ({
  enumerateConnectedUsbDevices: vi.fn(async () => []),
}));

import { installDeviceAccess } from './device-access.mjs';
import { enumerateConnectedUsbDevices } from './serial-device-enumeration.mjs';

describe('Electron device access lifecycle', () => {
  it('can dispose after BrowserWindow has destroyed its webContents getter', () => {
    const session = Object.assign(new EventEmitter(), {
      setBluetoothPairingHandler: vi.fn(),
      setDevicePermissionHandler: vi.fn(),
      setPermissionCheckHandler: vi.fn(),
      setPermissionRequestHandler: vi.fn(),
    });
    const webContents = Object.assign(new EventEmitter(), {
      id: 7,
      mainFrame: {},
      send: vi.fn(),
      session,
    });
    let destroyed = false;
    const window = {
      get webContents() {
        if (destroyed) throw new Error('Object has been destroyed');
        return webContents;
      },
    };
    const ipcMain = {
      handle: vi.fn(),
      removeHandler: vi.fn(),
    };

    const { dispose } = installDeviceAccess(window, ipcMain);
    destroyed = true;

    expect(dispose).not.toThrow();
    expect(webContents.listenerCount('select-bluetooth-device')).toBe(0);
    expect(session.listenerCount('select-serial-port')).toBe(0);
  });

  it('exposes connected USB names before the serial chooser has opened', async () => {
    const session = Object.assign(new EventEmitter(), {
      setBluetoothPairingHandler: vi.fn(),
      setDevicePermissionHandler: vi.fn(),
      setPermissionCheckHandler: vi.fn(),
      setPermissionRequestHandler: vi.fn(),
    });
    const webContents = Object.assign(new EventEmitter(), {
      id: 7,
      mainFrame: {},
      send: vi.fn(),
      session,
    });
    const handlers = new Map();
    const ipcMain = {
      handle: vi.fn((channel, handler) => handlers.set(channel, handler)),
      removeHandler: vi.fn(),
    };

    const { dispose } = installDeviceAccess({ webContents }, ipcMain);
    vi.mocked(enumerateConnectedUsbDevices).mockResolvedValueOnce([{
      name: 'NRF52 DK',
      vendorId: '239a',
      productId: '8029',
    }]);

    await expect(handlers.get('retivum:device:serial-devices')({ sender: webContents })).resolves.toEqual([{
      name: 'NRF52 DK',
      vendorId: '239a',
      productId: '8029',
    }]);
    dispose();
  });
});
