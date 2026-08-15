import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createRNodeInterfaceDraft,
  createTcpInterfaceDraft,
  createUdpInterfaceDraft,
  createWebSocketInterfaceDraft,
} from '../../domain/settings';
import {
  detectInterfaceCapabilities,
  interfaceIsSupported,
  runtimeInterfaceConfigurations,
  selectRNodeDevice,
  supportedInterfaceTypes,
} from './interface-capabilities';
import {
  answerDesktopDeviceSelection,
  desktopDeviceSelection,
} from './desktop-device-selection';

afterEach(() => {
  window.retivumDesktopDevices = undefined;
  desktopDeviceSelection.set(undefined);
  vi.unstubAllGlobals();
});

describe('platform interface capabilities', () => {
  it('only advertises interface types with a usable platform transport', () => {
    const browser = detectInterfaceCapabilities({ native: false, bluetooth: false, serial: false, socketBridge: false, datagramBridge: false });
    expect(supportedInterfaceTypes(browser)).toEqual(['websocket']);

    const chrome = detectInterfaceCapabilities({ native: false, bluetooth: true, serial: true, socketBridge: false, datagramBridge: false });
    expect(supportedInterfaceTypes(chrome)).toEqual(['websocket', 'rnode']);
    expect(chrome.rnodeConnections).toEqual(['ble', 'serial']);

    const electron = detectInterfaceCapabilities({ native: false, bluetooth: false, serial: true, socketBridge: true, datagramBridge: true });
    expect(supportedInterfaceTypes(electron)).toEqual(['websocket', 'rnode', 'tcp', 'udp']);
  });

  it('checks the configured RNode connection independently', () => {
    const mobile = detectInterfaceCapabilities({ native: true, bluetooth: false, serial: false, socketBridge: false, datagramBridge: false });
    expect(interfaceIsSupported(createRNodeInterfaceDraft('ble'), mobile)).toBe(true);
    expect(interfaceIsSupported(createRNodeInterfaceDraft('serial'), mobile)).toBe(false);
    expect(interfaceIsSupported(createTcpInterfaceDraft(), mobile)).toBe(true);
    expect(interfaceIsSupported(createUdpInterfaceDraft(), mobile)).toBe(true);
  });

  it('disables WebSocket interfaces on Android and iOS', () => {
    const android = detectInterfaceCapabilities({
      platform: 'android',
      native: true,
      bluetooth: false,
      serial: false,
      socketBridge: false,
      datagramBridge: false,
    });
    const ios = detectInterfaceCapabilities({
      platform: 'ios',
      native: true,
      bluetooth: false,
      serial: false,
      socketBridge: false,
      datagramBridge: false,
    });
    const websocket = createWebSocketInterfaceDraft('relay');
    const rnode = createRNodeInterfaceDraft('ble');

    expect(supportedInterfaceTypes(android)).toEqual(['rnode', 'tcp', 'udp']);
    expect(interfaceIsSupported(websocket, android)).toBe(false);
    expect(runtimeInterfaceConfigurations([websocket, rnode], android)).toEqual([rnode]);

    expect(supportedInterfaceTypes(ios)).toEqual(['rnode', 'tcp', 'udp']);
    expect(interfaceIsSupported(websocket, ios)).toBe(false);
    expect(runtimeInterfaceConfigurations([websocket, rnode], ios)).toEqual([rnode]);
  });

  it('keeps the Electron serial chooser name in a new RNode interface selection', async () => {
    vi.stubGlobal('navigator', {
      serial: {
        requestPort: vi.fn().mockResolvedValue({
          getInfo: () => ({ usbVendorId: 0x1915, usbProductId: 0x521f }),
        }),
      },
    });
    window.retivumDesktopDevices = {
      serialDevices: vi.fn().mockResolvedValue([]),
      respond: vi.fn().mockResolvedValue(undefined),
      respondPairing: vi.fn(),
      onSelectionRequest: vi.fn(),
      onPairingRequest: vi.fn(),
    };
    desktopDeviceSelection.set({
      requestId: 'serial-interface-picker',
      type: 'serial',
      devices: [{ id: 'port-1', name: 'nRF52 DK', detail: '1915:521f' }],
    });
    await answerDesktopDeviceSelection('serial-interface-picker', 'port-1');

    await expect(selectRNodeDevice('serial')).resolves.toEqual({
      deviceId: '1915:521f',
      deviceName: 'nRF52 DK',
      usbVendorId: 0x1915,
      usbProductId: 0x521f,
    });
  });
});
