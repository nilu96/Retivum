import { describe, expect, it } from 'vitest';
import { createRNodeInterfaceDraft, createTcpInterfaceDraft, createUdpInterfaceDraft } from '../../domain/settings';
import { detectInterfaceCapabilities, interfaceIsSupported, supportedInterfaceTypes } from './interface-capabilities';

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
});
