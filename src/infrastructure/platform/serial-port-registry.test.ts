import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRNodeInterfaceDraft } from '../../domain/settings';
import {
  configureSerialPortRegistry,
  listAssignedSerialPorts,
  resolveConfiguredSerialPort,
} from './serial-port-registry';

class RegistrySerialPort {
  connected = true;

  constructor(private readonly info: SerialPortInfo) {}

  getInfo(): SerialPortInfo {
    return this.info;
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('serial port registry', () => {
  it('assigns identical authorized ports one-to-one in stable interface order', async () => {
    const firstPort = new RegistrySerialPort({ usbVendorId: 9114, usbProductId: 32809 });
    const secondPort = new RegistrySerialPort({ usbVendorId: 9114, usbProductId: 32809 });
    const firstInterface = createRNodeInterfaceDraft('serial', 'first-identical-rnode');
    const secondInterface = createRNodeInterfaceDraft('serial', 'second-identical-rnode');
    firstInterface.createdAt = '2026-01-01T00:00:00.000Z';
    secondInterface.createdAt = '2026-01-02T00:00:00.000Z';
    for (const config of [firstInterface, secondInterface]) {
      config.connection.usbVendorId = 9114;
      config.connection.usbProductId = 32809;
    }
    vi.stubGlobal('navigator', {
      serial: {
        getPorts: vi.fn().mockResolvedValue([firstPort, secondPort]),
        requestPort: vi.fn(),
      },
    });

    configureSerialPortRegistry([secondInterface, firstInterface]);

    await expect(resolveConfiguredSerialPort(firstInterface)).resolves.toBe(firstPort);
    await expect(resolveConfiguredSerialPort(secondInterface)).resolves.toBe(secondPort);
    await expect(listAssignedSerialPorts([secondInterface, firstInterface])).resolves.toEqual([
      expect.objectContaining({ port: firstPort, configuredInterface: firstInterface }),
      expect.objectContaining({ port: secondPort, configuredInterface: secondInterface }),
    ]);
  });

  it('keeps an absent slot reserved and restores only that slot after a reboot', async () => {
    const firstPort = new RegistrySerialPort({ usbVendorId: 0x239a, usbProductId: 0x8029 });
    const secondPort = new RegistrySerialPort({ usbVendorId: 0x239a, usbProductId: 0x8029 });
    const replacementFirstPort = new RegistrySerialPort({ usbVendorId: 0x239a, usbProductId: 0x8029 });
    const firstInterface = createRNodeInterfaceDraft('serial', 'rebooting-rnode');
    const secondInterface = createRNodeInterfaceDraft('serial', 'stable-rnode');
    firstInterface.createdAt = '2026-02-01T00:00:00.000Z';
    secondInterface.createdAt = '2026-02-02T00:00:00.000Z';
    for (const config of [firstInterface, secondInterface]) {
      config.connection.usbVendorId = 0x239a;
      config.connection.usbProductId = 0x8029;
    }
    const getPorts = vi.fn()
      .mockResolvedValueOnce([firstPort, secondPort])
      .mockResolvedValueOnce([secondPort])
      .mockResolvedValueOnce([secondPort])
      .mockResolvedValue([replacementFirstPort, secondPort]);
    vi.stubGlobal('navigator', { serial: { getPorts, requestPort: vi.fn() } });

    configureSerialPortRegistry([firstInterface, secondInterface]);
    await expect(resolveConfiguredSerialPort(firstInterface)).resolves.toBe(firstPort);
    firstPort.connected = false;

    await expect(resolveConfiguredSerialPort(firstInterface)).rejects.toThrow('RNODE_SERIAL_NOT_AUTHORIZED');
    await expect(resolveConfiguredSerialPort(secondInterface)).resolves.toBe(secondPort);
    await expect(resolveConfiguredSerialPort(firstInterface)).resolves.toBe(replacementFirstPort);
    await expect(resolveConfiguredSerialPort(secondInterface)).resolves.toBe(secondPort);
  });
});
