import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  systemPreferences: {
    askForMediaAccess: vi.fn(),
    getMediaAccessStatus: vi.fn(() => 'granted'),
  },
}));

import { installDeviceAccess } from './device-access.mjs';

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
});
