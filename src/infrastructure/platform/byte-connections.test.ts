import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RNodeInterfaceConfig } from '../../domain/settings';

const mocks = vi.hoisted(() => ({
  initialize: vi.fn(),
  getDevices: vi.fn(),
  isBonded: vi.fn(),
  createBond: vi.fn(),
  connect: vi.fn(),
  getServices: vi.fn(),
  startNotifications: vi.fn(),
  writeWithoutResponse: vi.fn(),
  stopNotifications: vi.fn(),
  disconnect: vi.fn(),
}));

const capacitorPlatform = vi.hoisted(() => ({
  native: true,
  name: 'android',
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => capacitorPlatform.native,
    getPlatform: () => capacitorPlatform.name,
  },
}));

vi.mock('@capacitor-community/bluetooth-le', () => ({
  BleClient: mocks,
}));

vi.mock('@devioarts/capacitor-tcpclient', () => ({
  TCPClient: {},
}));

import { createRNodeByteConnection, isRetryableBleError } from './byte-connections';

const config: RNodeInterfaceConfig = {
  id: 'native-rnode',
  schemaVersion: 3,
  type: 'rnode',
  name: 'RNode',
  enabled: true,
  mode: 'full',
  reannounceOnReconnect: false,
  connection: { type: 'ble', deviceId: 'AA:BB:CC:DD:EE:FF' },
  radio: {
    frequency: 869_525_000,
    bandwidth: 125_000,
    txPower: 21,
    spreadingFactor: 8,
    codingRate: 5,
    dutyCycle: 10,
    flowControl: false,
  },
};

describe('BLE connection recovery', () => {
  it.each([
    new DOMException('GATT operation failed', 'NetworkError'),
    new Error('Device disconnected during service discovery'),
    new Error('Connection interrupted while pairing'),
    new Error('Encryption is insufficient'),
    new Error('authorize RX characteristic timed out'),
  ])('retries transient pairing and GATT failures', (error) => {
    expect(isRetryableBleError(error)).toBe(true);
  });

  it('does not retry an authorization failure', () => {
    expect(isRetryableBleError(new Error('RNODE_BLE_NOT_AUTHORIZED'))).toBe(false);
  });
});

describe('native BLE byte connection', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    capacitorPlatform.native = true;
    capacitorPlatform.name = 'android';
    for (const mock of Object.values(mocks)) mock.mockReset();
    mocks.initialize.mockResolvedValue(undefined);
    mocks.getDevices.mockResolvedValue([{ deviceId: 'AA:BB:CC:DD:EE:FF', name: 'RNode' }]);
    mocks.isBonded.mockResolvedValue(false);
    mocks.createBond.mockResolvedValue(undefined);
    mocks.connect.mockResolvedValue(undefined);
    mocks.getServices.mockResolvedValue([{
      uuid: '6E400001-B5A3-F393-E0A9-E50E24DCCA9E',
      characteristics: [
        { uuid: '6E400002-B5A3-F393-E0A9-E50E24DCCA9E' },
        { uuid: '6E400003-B5A3-F393-E0A9-E50E24DCCA9E' },
      ],
    }]);
    mocks.startNotifications.mockResolvedValue(undefined);
    mocks.writeWithoutResponse.mockResolvedValue(undefined);
    mocks.stopNotifications.mockResolvedValue(undefined);
    mocks.disconnect.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('bonds, connects, streams notifications, and chunks writes through BleClient', async () => {
    let onDisconnect: (() => void) | undefined;
    let onNotification: ((value: DataView) => void) | undefined;
    mocks.connect.mockImplementation(async (_deviceId, callback) => {
      onDisconnect = callback;
    });
    mocks.startNotifications.mockImplementation(async (_deviceId, _service, _characteristic, callback) => {
      onNotification = callback;
    });
    const onData = vi.fn();
    const onClosed = vi.fn();
    const connection = createRNodeByteConnection(config);

    const opening = connection.open(onData, onClosed);
    await vi.advanceTimersByTimeAsync(4_250);
    await opening;

    expect(mocks.initialize).toHaveBeenCalledWith({ androidNeverForLocation: true });
    expect(mocks.getDevices).toHaveBeenCalledWith(['AA:BB:CC:DD:EE:FF']);
    expect(mocks.createBond).toHaveBeenCalledWith('AA:BB:CC:DD:EE:FF', { timeout: 45_000 });
    expect(mocks.connect).toHaveBeenCalledWith(
      'AA:BB:CC:DD:EE:FF',
      expect.any(Function),
      { timeout: 15_000 },
    );

    const notificationBytes = Uint8Array.from([0, 7, 8, 0]);
    onNotification?.(new DataView(notificationBytes.buffer, 1, 2));
    expect(onData).toHaveBeenCalledWith(Uint8Array.from([7, 8]));

    await connection.write(Uint8Array.from({ length: 45 }, (_, index) => index));
    expect(mocks.writeWithoutResponse).toHaveBeenCalledTimes(3);
    expect(dataViewBytes(mocks.writeWithoutResponse.mock.calls[0][3] as DataView)).toEqual(
      Array.from({ length: 20 }, (_, index) => index),
    );
    expect(dataViewBytes(mocks.writeWithoutResponse.mock.calls[2][3] as DataView)).toEqual([40, 41, 42, 43, 44]);

    onDisconnect?.();
    expect(onClosed).toHaveBeenCalledTimes(1);

    await connection.close();
    expect(mocks.stopNotifications).toHaveBeenCalledWith(
      'AA:BB:CC:DD:EE:FF',
      '6e400001-b5a3-f393-e0a9-e50e24dcca9e',
      '6e400003-b5a3-f393-e0a9-e50e24dcca9e',
    );
    expect(mocks.disconnect).toHaveBeenCalledWith('AA:BB:CC:DD:EE:FF');
  });

  it('disconnects the peripheral before notification cleanup during explicit close', async () => {
    let onDisconnect: (() => void) | undefined;
    mocks.connect.mockImplementation(async (_deviceId, callback) => {
      onDisconnect = callback;
    });
    mocks.disconnect.mockImplementation(async () => {
      onDisconnect?.();
    });
    const onClosed = vi.fn();
    const connection = createRNodeByteConnection(config);

    const opening = connection.open(vi.fn(), onClosed);
    await vi.advanceTimersByTimeAsync(4_250);
    await opening;
    await connection.close();

    expect(mocks.disconnect).toHaveBeenCalledWith('AA:BB:CC:DD:EE:FF');
    expect(mocks.stopNotifications).toHaveBeenCalledWith(
      'AA:BB:CC:DD:EE:FF',
      '6e400001-b5a3-f393-e0a9-e50e24dcca9e',
      '6e400003-b5a3-f393-e0a9-e50e24dcca9e',
    );
    expect(mocks.disconnect.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.stopNotifications.mock.invocationCallOrder[0],
    );
    expect(onClosed).not.toHaveBeenCalled();
  });

  it('gives the RNode time to process final shutdown frames before native BLE disconnect', async () => {
    const connection = createRNodeByteConnection(config);
    const opening = connection.open(vi.fn(), vi.fn());
    await vi.advanceTimersByTimeAsync(4_250);
    await opening;

    const shutdown = Uint8Array.of(
      0xc0, 0x06, 0x00, 0xc0,
      0xc0, 0x0a, 0xff, 0xc0,
    );
    const closing = connection.close(shutdown);
    await vi.advanceTimersByTimeAsync(149);
    expect(mocks.disconnect).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await closing;

    expect(dataViewBytes(mocks.writeWithoutResponse.mock.calls[0][3] as DataView)).toEqual(Array.from(shutdown));
    expect(mocks.writeWithoutResponse.mock.calls[0][4]).toEqual({ timeout: 1_000 });
    expect(mocks.disconnect).toHaveBeenCalledWith('AA:BB:CC:DD:EE:FF');
  });

  it('always disconnects Web Bluetooth when the final RNode write stalls', async () => {
    capacitorPlatform.native = false;
    capacitorPlatform.name = 'web';
    const stalledWrite = new Promise<void>(() => undefined);
    const writeCharacteristic = Object.assign(new EventTarget(), {
      writeValue: vi.fn().mockReturnValue(stalledWrite),
      writeValueWithoutResponse: vi.fn().mockReturnValue(stalledWrite),
      startNotifications: vi.fn(),
      stopNotifications: vi.fn(),
    }) as BluetoothRemoteGattCharacteristic;
    const notifyCharacteristic = Object.assign(new EventTarget(), {
      writeValue: vi.fn(),
      startNotifications: vi.fn().mockResolvedValue(undefined),
      stopNotifications: vi.fn(),
    }) as BluetoothRemoteGattCharacteristic;
    const service = {
      getCharacteristic: vi.fn().mockImplementation(async (uuid: string) => (
        uuid === '6e400002-b5a3-f393-e0a9-e50e24dcca9e'
          ? writeCharacteristic
          : notifyCharacteristic
      )),
    } as BluetoothRemoteGattService;
    const disconnect = vi.fn();
    const gatt = {
      connected: true,
      connect: vi.fn(),
      disconnect,
      getPrimaryService: vi.fn().mockResolvedValue(service),
    } as unknown as BluetoothRemoteGattServer;
    gatt.connect = vi.fn().mockResolvedValue(gatt);
    const device = Object.assign(new EventTarget(), {
      id: 'web-rnode',
      name: 'RNode Web',
      gatt,
    }) as BluetoothDevice;
    vi.stubGlobal('navigator', {
      bluetooth: {
        getDevices: vi.fn().mockResolvedValue([device]),
      },
    });
    const connection = createRNodeByteConnection({
      ...config,
      id: 'web-rnode-interface',
      connection: { type: 'ble', deviceId: device.id },
    });

    const opening = connection.open(vi.fn(), vi.fn());
    await vi.advanceTimersByTimeAsync(750);
    await opening;
    const closing = connection.close(Uint8Array.of(0xc0, 0x06, 0x00, 0xc0));
    await vi.advanceTimersByTimeAsync(1_000);
    await closing;

    expect(writeCharacteristic.writeValueWithoutResponse).toHaveBeenCalled();
    expect(disconnect).toHaveBeenCalledTimes(1);
  });
});

function dataViewBytes(value: DataView): number[] {
  return Array.from(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
}
