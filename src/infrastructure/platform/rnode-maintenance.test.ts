import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRNodeInterfaceDraft } from '../../domain/settings';
import type { ByteConnection } from './byte-connections';
import { KissDeframer, frame } from './rnode-host';
import {
  listAuthorizedRNodes,
  listAuthorizedSerialRNodes,
  requestSerialRNode,
  RNodeMaintenanceSession,
} from './rnode-maintenance';
import {
  answerDesktopDeviceSelection,
  desktopDeviceSelection,
} from './desktop-device-selection';

class FakeSerialPort {
  readonly readable: ReadableStream<Uint8Array>;
  readonly writable: WritableStream<Uint8Array>;
  readonly writes: Uint8Array[] = [];
  readonly opens: number[] = [];
  readonly eeprom = new Uint8Array(200);
  closeCount = 0;
  private readonly controller: ReadableStreamDefaultController<Uint8Array>;
  private readonly decoder = new KissDeframer(1_100_000);

  constructor(
    private readonly info: SerialPortInfo,
    private readonly respond = true,
    readonly connected = true,
  ) {
    this.eeprom[0xa7] = 0x73;
    this.eeprom[0xb9] = 0;
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    this.readable = new ReadableStream({
      start(nextController) { controller = nextController; },
    });
    this.controller = controller;
    this.writable = new WritableStream({
      write: (chunk) => {
        const copy = Uint8Array.from(chunk);
        this.writes.push(copy);
        if (!this.respond) return;
        for (const received of this.decoder.process(copy)) this.respondTo(received.command, received.payload);
      },
    });
  }

  getInfo(): SerialPortInfo { return this.info; }
  async open(options: { baudRate: number }): Promise<void> { this.opens.push(options.baudRate); }
  async close(): Promise<void> { this.closeCount += 1; }
  emit(command: number, payload: ArrayLike<number>): void { this.controller.enqueue(frame(command, payload)); }

  private respondTo(command: number, payload: Uint8Array): void {
    if (command === 0x08) this.emit(0x08, [0x46]);
    else if (command === 0x50) this.emit(0x50, [1, 73]);
    else if (command === 0x48) this.emit(0x48, [0x80]);
    else if (command === 0x49) this.emit(0x49, [0x81]);
    else if (command === 0x47) this.emit(0x47, [0x35]);
    else if (command === 0x51) this.emit(0x51, this.eeprom);
    else if (command === 0x52 && payload.byteLength === 2) this.eeprom[payload[0]] = payload[1];
    else if (command === 0x01 && payload.every((byte) => byte === 0)) this.emit(0x01, [0x33, 0xd1, 0x9d, 0x80]);
    else if (command === 0x02 && payload.every((byte) => byte === 0)) this.emit(0x02, [0x00, 0x01, 0xe8, 0x48]);
    else if (command === 0x03 && payload[0] === 0xff) this.emit(0x03, [0xfd]);
    else if (command === 0x04 && payload[0] === 0xff) this.emit(0x04, [8]);
    else if (command === 0x05 && payload[0] === 0xff) this.emit(0x05, [5]);
    else if (command === 0x86) this.emit(0x87, payload);
  }
}

class FakeBleConnection implements ByteConnection {
  readonly writes: Uint8Array[] = [];
  readonly eeprom = new Uint8Array(200);
  finalData?: Uint8Array;
  openCount = 0;
  closeCount = 0;
  private onData: (data: Uint8Array) => void = () => undefined;
  private readonly decoder = new KissDeframer(1_100_000);

  constructor() {
    this.eeprom[0xa7] = 0x73;
  }

  async open(onData: (data: Uint8Array) => void): Promise<void> {
    this.openCount += 1;
    this.onData = onData;
  }

  async write(data: Uint8Array): Promise<void> {
    const copy = Uint8Array.from(data);
    this.writes.push(copy);
    for (const received of this.decoder.process(copy)) this.respondTo(received.command, received.payload);
  }

  async close(finalData?: Uint8Array): Promise<void> {
    this.closeCount += 1;
    this.finalData = finalData;
  }

  private emit(command: number, payload: ArrayLike<number>): void {
    const encoded = frame(command, payload);
    const split = Math.max(1, Math.floor(encoded.byteLength / 2));
    this.onData(encoded.slice(0, split));
    this.onData(encoded.slice(split));
  }

  private respondTo(command: number, payload: Uint8Array): void {
    if (command === 0x08) this.emit(0x08, [0x46]);
    else if (command === 0x50) this.emit(0x50, [1, 80]);
    else if (command === 0x48) this.emit(0x48, [0x70]);
    else if (command === 0x49) this.emit(0x49, [0x71]);
    else if (command === 0x47) this.emit(0x47, [0x50]);
    else if (command === 0x51) this.emit(0x51, this.eeprom);
    else if (command === 0x86) this.emit(0x87, payload);
  }
}

afterEach(() => {
  window.retivumDesktopBluetooth = undefined;
  window.retivumDesktopDevices = undefined;
  desktopDeviceSelection.set(undefined);
  vi.unstubAllGlobals();
});

describe('RNode maintenance serial directory', () => {
  it('shows authorized ports with matching configured serial interfaces', async () => {
    const port = new FakeSerialPort({ usbVendorId: 0x10c4, usbProductId: 0xea60 });
    const disconnectedPort = new FakeSerialPort({}, true, false);
    const config = createRNodeInterfaceDraft('serial', 'serial-interface');
    config.name = 'Workshop RNode';
    config.connection.usbVendorId = 0x10c4;
    config.connection.usbProductId = 0xea60;
    vi.stubGlobal('navigator', {
      serial: { getPorts: vi.fn().mockResolvedValue([port, disconnectedPort]), requestPort: vi.fn() },
    });

    const devices = await listAuthorizedSerialRNodes([config]);

    expect(devices).toHaveLength(1);
    expect(devices[0]).toMatchObject({
      label: 'Workshop RNode',
      detail: 'USB 10c4:ea60',
      configuredInterface: config,
    });
  });

  it('retains the Electron chooser name when the serial directory refreshes', async () => {
    const port = new FakeSerialPort({ usbVendorId: 0x1915, usbProductId: 0x521f });
    vi.stubGlobal('navigator', {
      serial: {
        getPorts: vi.fn().mockResolvedValue([port]),
        requestPort: vi.fn().mockResolvedValue(port),
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
      requestId: 'serial-picker',
      type: 'serial',
      devices: [{ id: 'port-1', name: 'nRF52 DK', detail: '1915:521f' }],
    });
    await answerDesktopDeviceSelection('serial-picker', 'port-1');

    const selected = await requestSerialRNode([]);
    const refreshed = await listAuthorizedSerialRNodes([]);

    expect(selected.label).toBe('nRF52 DK');
    expect(refreshed[0].label).toBe('nRF52 DK');
    expect(refreshed[0].detail).toBe('USB 1915:521f');
  });

  it('uses Electron serial metadata during automatic device refresh', async () => {
    const port = new FakeSerialPort({ usbVendorId: 0x239a, usbProductId: 0x8029 });
    vi.stubGlobal('navigator', {
      serial: { getPorts: vi.fn().mockResolvedValue([port]), requestPort: vi.fn() },
    });
    window.retivumDesktopDevices = {
      serialDevices: vi.fn().mockResolvedValue([{
        id: 'serial-1',
        name: 'NRF52 DK',
        vendorId: '239a',
        productId: '8029',
      }]),
      respond: vi.fn(),
      respondPairing: vi.fn(),
      onSelectionRequest: vi.fn(),
      onPairingRequest: vi.fn(),
    };

    const devices = await listAuthorizedSerialRNodes([]);

    expect(devices[0]).toMatchObject({
      label: 'NRF52 DK',
      deviceName: 'NRF52 DK',
      detail: 'USB 239a:8029',
    });
  });

  it('combines configured and browser-authorized BLE RNodes without duplicates', async () => {
    const config = createRNodeInterfaceDraft('ble', 'ble-interface');
    config.name = 'Pocket RNode';
    config.connection = { type: 'ble', deviceId: 'ble-device-1', deviceName: 'RNode BLE' };
    const device = Object.assign(new EventTarget(), {
      id: 'ble-device-1',
      name: 'RNode BLE',
    }) as BluetoothDevice;
    vi.stubGlobal('navigator', {
      bluetooth: { getDevices: vi.fn().mockResolvedValue([device]) },
    });

    const devices = await listAuthorizedRNodes([config]);

    expect(devices).toHaveLength(1);
    expect(devices[0]).toMatchObject({
      id: 'ble-ble-device-1',
      transport: 'ble',
      label: 'Pocket RNode',
      detail: 'BLE',
      configuredInterface: config,
      connectionConfig: {
        connection: { type: 'ble', deviceId: 'ble-device-1', deviceName: 'RNode BLE' },
      },
    });
  });

  it('does not query Chromium Bluetooth while Electron owns the BLE device', async () => {
    const config = createRNodeInterfaceDraft('ble', 'electron-ble-interface');
    config.name = 'Electron RNode';
    config.connection = { type: 'ble', deviceId: 'native-device-1', deviceName: 'RNode BLE' };
    const getDevices = vi.fn().mockResolvedValue([]);
    vi.stubGlobal('navigator', { bluetooth: { getDevices } });
    window.retivumDesktopBluetooth = {} as RetivumDesktopBluetoothBridge;

    const devices = await listAuthorizedRNodes([config]);

    expect(getDevices).not.toHaveBeenCalled();
    expect(devices).toHaveLength(1);
    expect(devices[0]).toMatchObject({
      id: 'ble-native-device-1',
      label: 'Electron RNode',
      configuredInterface: config,
    });
  });
});

describe('RNode maintenance session', () => {
  it('runs device discovery and provisioning over a fragmented BLE byte stream', async () => {
    const config = createRNodeInterfaceDraft('ble', 'ble-maintenance');
    config.connection = { type: 'ble', deviceId: 'ble-device-1', deviceName: 'Pocket RNode' };
    const connection = new FakeBleConnection();
    const session = new RNodeMaintenanceSession({
      id: 'ble-ble-device-1',
      transport: 'ble',
      label: 'Pocket RNode',
      detail: 'BLE',
      connectionConfig: config,
      configuredInterface: config,
    }, undefined, undefined, undefined, undefined, connection);

    await expect(session.open()).resolves.toEqual({
      firmwareVersion: '1.80',
      platform: 0x70,
      mcu: 0x71,
      board: 0x50,
      eepromBytes: 200,
    });
    await expect(session.requestProvisioning(Uint8Array.of(1, 2, 3))).resolves.toEqual(Uint8Array.of(1, 2, 3));
    expect(connection.openCount).toBe(1);
    expect(connection.writes.flatMap((write) => new KissDeframer(1_100_000).process(write)))
      .toContainEqual({ command: 0x86, payload: Uint8Array.of(1, 2, 3) });

    await session.close();
    expect(connection.closeCount).toBe(1);
    expect(new KissDeframer(1_100_000).process(connection.finalData ?? new Uint8Array()))
      .toEqual([{ command: 0x0a, payload: Uint8Array.of(0xff) }]);
  });

  it('uses shared KISS framing for device information, provisioning, logs, and EEPROM wipe', async () => {
    const port = new FakeSerialPort({ usbVendorId: 0x303a, usbProductId: 0x1001 });
    const messages: string[] = [];
    const pins: string[] = [];
    const telemetry: unknown[] = [];
    const session = new RNodeMaintenanceSession({
      id: 'serial-1',
      transport: 'serial',
      label: 'Test RNode',
      detail: 'USB 303a:1001',
      port: port as unknown as SerialPort,
    }, (message) => messages.push(message), () => undefined, (pin) => pins.push(pin), (update) => telemetry.push(update));

    await expect(session.open()).resolves.toEqual({
      firmwareVersion: '1.73',
      platform: 0x80,
      mcu: 0x81,
      board: 0x35,
      eepromBytes: 200,
    });
    port.emit(0x80, new TextEncoder().encode('radio ready'));
    port.emit(0x62, [0, 1, 226, 64]);
    port.emit(0x25, [0, 55, 7, 154, 0, 123, 1, 200, 52, 54, 0xff]);
    port.emit(0x27, [1, 96]);
    port.emit(0x29, [145]);
    await vi.waitFor(() => expect(messages).toEqual(['radio ready']));
    expect(pins).toEqual(['123456']);
    expect(telemetry).toEqual([{
      airtimeShortPercent: 0.55,
      airtimeLongPercent: 19.46,
      channelLoadShortPercent: 1.23,
      channelLoadLongPercent: 4.56,
      currentRssiDbm: -105,
      noiseFloorDbm: -103,
      interferenceDbm: undefined,
    }, {
      batteryState: 'discharging',
      batteryPercent: 96,
    }, {
      temperatureCelsius: 25,
    }]);

    await expect(session.requestProvisioning(Uint8Array.of(1, 2, 3))).resolves.toEqual(Uint8Array.of(1, 2, 3));
    await expect(session.restoreEeprom(new Uint8Array(199))).rejects.toThrow('RNODE_EEPROM_BACKUP_INVALID_SIZE');
    const backup = Uint8Array.from({ length: 200 }, (_value, index) => (index * 17) & 0xff);
    backup[0x9b] = 0x73;
    await expect(session.restoreEeprom(backup)).resolves.toEqual(backup);
    await expect(session.restoreEeprom(backup)).rejects.toThrow('RNODE_EEPROM_LOCKED');
    await session.wipeEeprom();

    const commands = port.writes.flatMap((write) => new KissDeframer(1_100_000).process(write));
    const restoreWrites = commands.filter(({ command }) => command === 0x52);
    expect(restoreWrites).toHaveLength(200);
    expect(restoreWrites.at(-1)).toEqual({ command: 0x52, payload: Uint8Array.of(0x9b, 0x73) });
    expect(commands).toContainEqual({ command: 0x59, payload: Uint8Array.of(0xf8) });
    await session.close();
    expect(port.closeCount).toBe(1);
  });

  it('reads and writes the standard RNode node configuration with exact KISS payloads', async () => {
    const port = new FakeSerialPort({ usbVendorId: 0x303a, usbProductId: 0x1001 });
    const session = new RNodeMaintenanceSession({
      id: 'serial-config',
      transport: 'serial',
      label: 'Config RNode',
      detail: 'USB 303a:1001',
      port: port as unknown as SerialPort,
    });
    await session.open();

    await expect(session.readRadioConfig()).resolves.toEqual({
      bootMode: 'tnc',
      frequency: 869_375_360,
      bandwidth: 125_000,
      spreadingFactor: 8,
      codingRate: 5,
      txPower: -3,
      interferenceAvoidance: true,
    });
    await session.saveRadioConfig({
      bootMode: 'tnc',
      frequency: 868_300_000,
      bandwidth: 125_000,
      spreadingFactor: 9,
      codingRate: 6,
      txPower: -3,
      interferenceAvoidance: false,
    });
    await session.setBluetooth(2);
    await session.unpairBluetooth();
    await session.saveWifiConfig({ mode: 1, channel: 11, ssid: 'mesh', psk: 'password', ip: '192.168.1.2', netmask: '255.255.255.0' });
    await session.saveDisplayConfig({ intensity: 127, blankingTimeout: 30, rotation: 2, address: 0x3c, neopixelIntensity: 64 });

    const commands = port.writes.flatMap((write) => new KissDeframer(1_100_000).process(write));
    expect(commands).toContainEqual({ command: 0x01, payload: Uint8Array.of(0x33, 0xc1, 0x34, 0xe0) });
    expect(commands).toContainEqual({ command: 0x03, payload: Uint8Array.of(0xfd) });
    expect(commands).toContainEqual({ command: 0x53, payload: Uint8Array.of(0) });
    expect(commands).toContainEqual({ command: 0x46, payload: Uint8Array.of(2) });
    expect(commands).toContainEqual({ command: 0x6b, payload: Uint8Array.of(0x6d, 0x65, 0x73, 0x68, 0) });
    expect(commands).toContainEqual({ command: 0x84, payload: Uint8Array.of(192, 168, 1, 2) });
    expect(commands).toContainEqual({ command: 0x45, payload: Uint8Array.of(127) });
    const writesBeforePartialDisplay = port.writes.length;
    await session.saveDisplayConfig({ blankingTimeout: 45 });
    const partialDisplayCommands = port.writes.slice(writesBeforePartialDisplay)
      .flatMap((write) => new KissDeframer(1_100_000).process(write));
    expect(partialDisplayCommands).toEqual([{ command: 0x64, payload: Uint8Array.of(45) }]);
    const writesBeforePartialWifi = port.writes.length;
    await session.saveWifiConfig({ ssid: 'field-node' });
    const partialWifiCommands = port.writes.slice(writesBeforePartialWifi)
      .flatMap((write) => new KissDeframer(1_100_000).process(write));
    expect(partialWifiCommands.map(({ command, payload }) => ({ command, payload: Array.from(payload) })))
      .toEqual([{ command: 0x6b, payload: Array.from(new TextEncoder().encode('field-node\0')) }]);
    const writesBeforeHostMode = port.writes.length;
    await session.saveRadioConfig({
      bootMode: 'host', frequency: 1, bandwidth: 1, spreadingFactor: 1, codingRate: 1,
      txPower: 99, interferenceAvoidance: false,
    });
    const hostCommands = port.writes.slice(writesBeforeHostMode).flatMap((write) => new KissDeframer(1_100_000).process(write));
    expect(hostCommands).toEqual([{ command: 0x54, payload: Uint8Array.of(0) }]);
    const writesBeforeInvalidWifi = port.writes.length;
    await expect(session.saveWifiConfig({
      mode: 1, channel: 11, ssid: 'mesh', psk: 'password', ip: '999.1.1.1', netmask: '255.255.255.0',
    })).rejects.toThrow('RNODE_CONFIG_INVALID_IPV4');
    expect(port.writes).toHaveLength(writesBeforeInvalidWifi);
    await session.close();
  });
});
