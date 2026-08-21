import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTcpInterfaceDraft, type RNodeInterfaceConfig } from '../../domain/settings';

const mocks = vi.hoisted(() => ({
  initialize: vi.fn(),
  getDevices: vi.fn(),
  getConnectedDevices: vi.fn(),
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

const tcpClient = vi.hoisted(() => ({
  createConnection: vi.fn(),
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
  TCPClient: tcpClient,
}));

import {
  authorizeNativeRNodeDevice,
  createRNodeByteConnection,
  createSerialPortByteConnection,
  createTcpByteConnection,
  isRetryableBleError,
} from './byte-connections';
import { rememberSelectedSerialPort } from './serial-port-registry';

describe('serial byte connection recovery', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('refreshes the authorized port handle before reopening after a close', async () => {
    function port(): SerialPort {
      return {
        readable: new ReadableStream<Uint8Array>(),
        writable: new WritableStream<Uint8Array>(),
        getInfo: () => ({ usbVendorId: 0x303a, usbProductId: 0x1001 }),
        open: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
      };
    }
    const original = port();
    const replacement = port();
    const getPorts = vi.fn().mockResolvedValue([replacement]);
    vi.stubGlobal('navigator', { serial: { getPorts, requestPort: vi.fn() } });
    const connection = createSerialPortByteConnection(original, rememberSelectedSerialPort(original));

    await connection.open(vi.fn(), vi.fn());
    await connection.close();
    await connection.open(vi.fn(), vi.fn());

    expect(getPorts).toHaveBeenCalledOnce();
    expect(original.open).toHaveBeenCalledOnce();
    expect(replacement.open).toHaveBeenCalledOnce();
    await connection.close();
  });
});

describe('Electron TCP byte connection', () => {
  afterEach(() => {
    window.retivumDesktopSockets = undefined;
  });

  it('treats a missing main-process socket as one closed transition', async () => {
    let eventListener: ((event: DesktopSocketEvent) => void) | undefined;
    const bridge: RetivumSocketBridge = {
      open: vi.fn().mockResolvedValue(undefined),
      write: vi.fn().mockRejectedValue(new Error('TCP_SOCKET_NOT_OPEN')),
      close: vi.fn().mockResolvedValue(undefined),
      onEvent: vi.fn((listener) => {
        eventListener = listener;
        return () => { eventListener = undefined; };
      }),
    };
    window.retivumDesktopSockets = bridge;
    const onClosed = vi.fn();
    const connection = createTcpByteConnection(createTcpInterfaceDraft('electron-tcp'));

    await connection.open(vi.fn(), onClosed);
    await connection.write(Uint8Array.of(1, 2, 3));
    await connection.write(Uint8Array.of(4, 5, 6));
    eventListener?.({ id: 'electron-tcp', type: 'closed' });

    expect(bridge.write).toHaveBeenCalledTimes(1);
    expect(onClosed).toHaveBeenCalledTimes(1);
    await connection.close();
  });
});

describe('Capacitor TCP byte connection', () => {
  afterEach(() => {
    window.retivumDesktopSockets = undefined;
    window.retivumMobileSockets = undefined;
    tcpClient.createConnection.mockReset();
  });

  it('destroys the native connection and listeners after connect fails', async () => {
    const removeData = vi.fn().mockResolvedValue(undefined);
    const removeDisconnect = vi.fn().mockResolvedValue(undefined);
    const destroy = vi.fn().mockResolvedValue(undefined);
    const connection = {
      addListener: vi.fn()
        .mockResolvedValueOnce({ remove: removeData })
        .mockResolvedValueOnce({ remove: removeDisconnect }),
      connect: vi.fn().mockResolvedValue({ error: true, errorMessage: 'connect failed', connected: false }),
      startRead: vi.fn(),
      write: vi.fn(),
      isConnected: vi.fn(),
      destroy,
    };
    tcpClient.createConnection.mockReturnValue(connection);
    const socket = createTcpByteConnection(createTcpInterfaceDraft('capacitor-failed'));

    await expect(socket.open(vi.fn(), vi.fn())).rejects.toThrow('connect failed');

    expect(removeData).toHaveBeenCalledOnce();
    expect(removeDisconnect).toHaveBeenCalledOnce();
    expect(destroy).toHaveBeenCalledOnce();
    expect(connection.startRead).not.toHaveBeenCalled();
  });

  it('uses a plugin-owned connection id so overlapping attempts cannot share native state', async () => {
    const connections = Array.from({ length: 2 }, () => ({
      addListener: vi.fn().mockResolvedValue({ remove: vi.fn().mockResolvedValue(undefined) }),
      connect: vi.fn().mockResolvedValue({ error: false, connected: true }),
      startRead: vi.fn().mockResolvedValue({ error: false, reading: true }),
      write: vi.fn(),
      isConnected: vi.fn().mockResolvedValue({ error: false, connected: true }),
      destroy: vi.fn().mockResolvedValue(undefined),
    }));
    tcpClient.createConnection
      .mockReturnValueOnce(connections[0])
      .mockReturnValueOnce(connections[1]);
    const config = createTcpInterfaceDraft('capacitor-retry');
    const first = createTcpByteConnection(config);
    const second = createTcpByteConnection(config);

    await first.open(vi.fn(), vi.fn());
    await second.open(vi.fn(), vi.fn());

    expect(tcpClient.createConnection).toHaveBeenCalledTimes(2);
    for (const [options] of tcpClient.createConnection.mock.calls) {
      expect(options).not.toHaveProperty('connectionId');
    }
    await Promise.all([first.close(), second.close()]);
  });

  it('checks native socket health for foreground resume recovery', async () => {
    const connection = {
      addListener: vi.fn().mockResolvedValue({ remove: vi.fn().mockResolvedValue(undefined) }),
      connect: vi.fn().mockResolvedValue({ error: false, connected: true }),
      startRead: vi.fn().mockResolvedValue({ error: false, reading: true }),
      write: vi.fn(),
      isConnected: vi.fn().mockResolvedValue({ error: false, connected: false }),
      destroy: vi.fn().mockResolvedValue(undefined),
    };
    tcpClient.createConnection.mockReturnValue(connection);
    const socket = createTcpByteConnection(createTcpInterfaceDraft('capacitor-resume'));

    await socket.open(vi.fn(), vi.fn());

    await expect(socket.isConnected?.()).resolves.toBe(false);
    expect(connection.isConnected).toHaveBeenCalledOnce();
    await socket.close();
  });
});

const config: RNodeInterfaceConfig = {
  id: 'native-rnode',
  schemaVersion: 5,
  createdAt: '2026-07-29T12:00:00.000Z',
  type: 'rnode',
  name: 'RNode',
  enabled: true,
  mode: 'full',
  reannounceOnReconnect: false,
  ifac: { networkName: '', passphrase: '', credentialRevision: 'test' },
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
    window.retivumDesktopBluetooth = undefined;
    for (const mock of Object.values(mocks)) mock.mockReset();
    mocks.initialize.mockResolvedValue(undefined);
    mocks.getDevices.mockResolvedValue([{ deviceId: 'AA:BB:CC:DD:EE:FF', name: 'RNode' }]);
    mocks.getConnectedDevices.mockResolvedValue([{ deviceId: 'AA:BB:CC:DD:EE:FF', name: 'RNode' }]);
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

  it('ends an Android authorization attempt when the system bond prompt is rejected', async () => {
    mocks.createBond.mockRejectedValue(new Error('Creating bond failed.'));

    const authorization = authorizeNativeRNodeDevice('AA:BB:CC:DD:EE:FF');

    await expect(authorization).rejects.toThrow('RNODE_BLE_PAIRING_FAILED');
    expect(mocks.createBond).toHaveBeenCalledTimes(1);
    expect(mocks.connect).not.toHaveBeenCalled();
  });

  it.each([
    new Error('Pairing request was cancelled by the user.'),
    new Error('Encryption is insufficient.'),
  ])('does not reopen the iOS PIN prompt after protected access fails', async (error) => {
    capacitorPlatform.name = 'ios';
    mocks.startNotifications.mockRejectedValue(error);

    const authorization = authorizeNativeRNodeDevice('AA:BB:CC:DD:EE:FF');
    const rejected = expect(authorization).rejects.toThrow('RNODE_BLE_PAIRING_FAILED');
    await vi.advanceTimersByTimeAsync(750);

    await rejected;
    expect(mocks.connect).toHaveBeenCalledTimes(1);
    expect(mocks.startNotifications).toHaveBeenCalledTimes(1);
  });

  it('checks the operating-system connection inventory after a mobile resume', async () => {
    const connection = createRNodeByteConnection(config);
    const opening = connection.open(vi.fn(), vi.fn());
    await vi.advanceTimersByTimeAsync(4_250);
    await opening;

    await expect(connection.isConnected?.()).resolves.toBe(true);
    expect(mocks.getConnectedDevices).toHaveBeenCalledWith([
      '6e400001-b5a3-f393-e0a9-e50e24dcca9e',
    ]);

    mocks.getConnectedDevices.mockResolvedValue([]);
    await expect(connection.isConnected?.()).resolves.toBe(false);
    await connection.close();
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

  it('stops native BLE retries when an interface is closed during protected access', async () => {
    mocks.isBonded.mockResolvedValue(true);
    mocks.startNotifications.mockReturnValue(new Promise(() => undefined));
    const connection = createRNodeByteConnection(config);

    const opening = connection.open(vi.fn(), vi.fn());
    await vi.advanceTimersByTimeAsync(750);
    expect(mocks.startNotifications).toHaveBeenCalledTimes(1);

    await connection.close();
    await expect(opening).rejects.toThrow('disconnected while establishing');
    await vi.advanceTimersByTimeAsync(30_000);

    expect(mocks.connect).toHaveBeenCalledTimes(1);
    expect(mocks.startNotifications).toHaveBeenCalledTimes(1);
    expect(mocks.disconnect).toHaveBeenCalledWith('AA:BB:CC:DD:EE:FF');
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

  it('prefers the Electron bridge, streams bytes, and preserves graceful shutdown', async () => {
    let eventListener: ((event: DesktopBluetoothEvent) => void) | undefined;
    const bridge: RetivumDesktopBluetoothBridge = {
      startScan: vi.fn(),
      stopScan: vi.fn(),
      pair: vi.fn(),
      connectedDevices: vi.fn().mockResolvedValue([]),
      open: vi.fn().mockResolvedValue(undefined),
      write: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
      onEvent: vi.fn((listener) => {
        eventListener = listener;
        return () => { eventListener = undefined; };
      }),
    };
    window.retivumDesktopBluetooth = bridge;
    const onData = vi.fn();
    const onClosed = vi.fn();
    const connection = createRNodeByteConnection({
      ...config,
      id: 'electron-rnode',
      connection: {
        type: 'ble',
        deviceId: 'native-device-id',
      },
    });

    await connection.open(onData, onClosed);
    expect(bridge.open).toHaveBeenCalledWith({ id: 'electron-rnode', deviceId: 'native-device-id' });
    eventListener?.({ id: 'electron-rnode', type: 'data', data: [4, 5, 6] });
    expect(onData).toHaveBeenCalledWith(Uint8Array.of(4, 5, 6));

    await connection.write(Uint8Array.of(7, 8));
    expect(bridge.write).toHaveBeenCalledWith({ id: 'electron-rnode', data: [7, 8] });
    eventListener?.({ id: 'electron-rnode', type: 'closed' });
    expect(onClosed).toHaveBeenCalledTimes(1);

    const closing = connection.close(Uint8Array.of(0xc0, 0x06, 0, 0xc0));
    await vi.advanceTimersByTimeAsync(150);
    await closing;
    expect(bridge.close).toHaveBeenCalledWith({ id: 'electron-rnode' });
  });

});

function dataViewBytes(value: DataView): number[] {
  return Array.from(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
}
