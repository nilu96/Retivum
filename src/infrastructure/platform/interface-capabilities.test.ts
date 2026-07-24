import { describe, expect, it } from 'vitest';
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
  supportedInterfaceTypes,
} from './interface-capabilities';

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

  it('disables WebSocket interfaces on Android while retaining them on iOS', () => {
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

    expect(supportedInterfaceTypes(ios)).toEqual(['websocket', 'rnode', 'tcp', 'udp']);
    expect(interfaceIsSupported(websocket, ios)).toBe(true);
    expect(runtimeInterfaceConfigurations([websocket, rnode], ios)).toEqual([websocket, rnode]);
  });
});
