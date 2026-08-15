import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { createNobleBackend, registerDesktopBluetooth } from './desktop-bluetooth.mjs';

function harness() {
  const handlers = new Map();
  const ipcMain = {
    handle: vi.fn((channel, handler) => handlers.set(channel, handler)),
    removeHandler: vi.fn((channel) => handlers.delete(channel)),
  };
  const senderFrame = {};
  const sender = {
    id: 17,
    isDestroyed: vi.fn().mockReturnValue(false),
    send: vi.fn(),
  };
  const event = { senderFrame, sender };
  let scanDevice;
  let connectionHooks;
  const backend = {
    startScan: vi.fn(async (listener) => { scanDevice = listener; }),
    stopScan: vi.fn().mockResolvedValue(undefined),
    pair: vi.fn(async (deviceId, requestPin) => {
      await requestPin();
      return deviceId;
    }),
    open: vi.fn(async (_id, _deviceId, hooks) => { connectionHooks = hooks; }),
    write: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    dispose: vi.fn().mockResolvedValue(undefined),
  };
  const requestPairing = vi.fn().mockResolvedValue({ confirmed: true, pin: '123456' });
  const dispose = registerDesktopBluetooth(
    ipcMain,
    (frame) => frame === senderFrame,
    requestPairing,
    async () => backend,
  );
  return {
    backend,
    connectionHooks: () => connectionHooks,
    dispose,
    event,
    handlers,
    requestPairing,
    scanDevice: () => scanDevice,
    sender,
  };
}

describe('Electron native Bluetooth bridge', () => {
  it('filters scan results through the narrow renderer event contract', async () => {
    const context = harness();
    await context.handlers.get('retivum:ble:scan-start')(context.event);
    context.scanDevice()({ id: 'aabbccddeeff', name: '  RNode Field  ', detail: '-55 dBm' });

    expect(context.sender.send).toHaveBeenCalledWith('retivum:ble:event', {
      type: 'device',
      device: { id: 'aabbccddeeff', name: 'RNode Field', detail: '-55 dBm' },
    });
    await context.handlers.get('retivum:ble:scan-stop')(context.event);
    expect(context.backend.stopScan).toHaveBeenCalled();
    await context.dispose();
  });

  it('collects a PIN without exposing it in an event or persisted bridge state', async () => {
    const context = harness();
    const result = await context.handlers.get('retivum:ble:pair')(context.event, { deviceId: 'aabbccddeeff' });

    expect(context.requestPairing).toHaveBeenCalledWith({
      deviceId: 'aabbccddeeff',
      pairingKind: 'providePin',
    });
    expect(context.backend.pair).toHaveBeenCalledWith('aabbccddeeff', expect.any(Function));
    expect(result).toEqual({ deviceId: 'aabbccddeeff' });
    await context.dispose();
  });

  it('ends the pairing attempt when the PIN dialog is cancelled', async () => {
    const context = harness();
    context.requestPairing.mockResolvedValue({ confirmed: false });

    await expect(context.handlers.get('retivum:ble:pair')(
      context.event,
      { deviceId: 'aabbccddeeff' },
    )).rejects.toThrow('RNODE_BLE_PAIRING_FAILED');

    expect(context.requestPairing).toHaveBeenCalledTimes(1);
    expect(context.backend.pair).toHaveBeenCalledTimes(1);
    await context.dispose();
  });

  it.each([
    'Authentication failed',
    'The displayed passkey did not match',
  ])('reports a rejected PIN as a completed pairing failure', async (message) => {
    const context = harness();
    context.backend.pair.mockRejectedValueOnce(new Error(message));

    await expect(context.handlers.get('retivum:ble:pair')(
      context.event,
      { deviceId: 'aabbccddeeff' },
    )).rejects.toThrow('RNODE_BLE_PAIRING_FAILED');

    expect(context.backend.pair).toHaveBeenCalledTimes(1);
    await context.dispose();
  });

  it('owns connections by renderer and forwards bounded data in both directions', async () => {
    const context = harness();
    const open = context.handlers.get('retivum:ble:open');
    await open(context.event, { id: 'rnode-one', deviceId: 'aabbccddeeff' });
    context.connectionHooks().onData(Uint8Array.of(1, 2, 3));
    expect(context.sender.send).toHaveBeenCalledWith('retivum:ble:event', {
      id: 'rnode-one',
      type: 'data',
      data: [1, 2, 3],
    });

    await context.handlers.get('retivum:ble:write')(context.event, {
      id: 'rnode-one',
      data: [0xc0, 0x08, 0x73, 0xc0],
    });
    expect(context.backend.write).toHaveBeenCalledWith(
      'rnode-one',
      Uint8Array.of(0xc0, 0x08, 0x73, 0xc0),
    );

    context.connectionHooks().onClosed('RNODE_BLE_CONNECTION_FAILED');
    expect(context.sender.send).toHaveBeenLastCalledWith('retivum:ble:event', {
      id: 'rnode-one',
      type: 'error',
      errorCode: 'RNODE_BLE_CONNECTION_FAILED',
    });
    await context.dispose();
  });

  it('rejects untrusted senders and malformed byte payloads', async () => {
    const context = harness();
    const untrusted = { ...context.event, senderFrame: {} };
    await expect(context.handlers.get('retivum:ble:scan-start')(untrusted)).rejects.toThrow('UNTRUSTED_IPC_SENDER');

    await context.handlers.get('retivum:ble:open')(context.event, {
      id: 'rnode-one',
      deviceId: 'aabbccddeeff',
    });
    await expect(context.handlers.get('retivum:ble:write')(context.event, {
      id: 'rnode-one',
      data: [256],
    })).rejects.toThrow('RNODE_BLE_DATA_INVALID');
    await context.dispose();
  });
});

describe('native Noble RNode backend', () => {
  function fakeTransport() {
    let paired = false;
    const notify = Object.assign(new EventEmitter(), {
      uuid: '6e400003b5a3f393e0a9e50e24dcca9e',
      subscribeAsync: vi.fn().mockResolvedValue(undefined),
      unsubscribeAsync: vi.fn().mockResolvedValue(undefined),
    });
    const write = {
      uuid: '6e400002b5a3f393e0a9e50e24dcca9e',
      writeAsync: vi.fn().mockResolvedValue(undefined),
    };
    const peripheral = Object.assign(new EventEmitter(), {
      id: 'aabbccddeeff',
      address: 'AA:BB:CC:DD:EE:FF',
      state: 'disconnected',
      rssi: -42,
      advertisement: {
        localName: 'RNode',
        serviceUuids: ['6e400001b5a3f393e0a9e50e24dcca9e'],
      },
      connectAsync: vi.fn(async () => { peripheral.state = 'connected'; }),
      disconnectAsync: vi.fn(async () => { peripheral.state = 'disconnected'; }),
      isPaired: vi.fn(() => paired),
      pairAsync: vi.fn(async () => {
        paired = true;
        peripheral.state = 'disconnected';
      }),
      discoverSomeServicesAndCharacteristicsAsync: vi.fn().mockResolvedValue({
        services: [],
        characteristics: [write, notify],
      }),
    });
    const noble = Object.assign(new EventEmitter(), {
      state: 'poweredOn',
      waitForPoweredOnAsync: vi.fn().mockResolvedValue(undefined),
      startScanningAsync: vi.fn().mockResolvedValue(undefined),
      stopScanningAsync: vi.fn().mockResolvedValue(undefined),
      connectAsync: vi.fn(async () => {
        peripheral.state = 'connected';
        return peripheral;
      }),
      stop: vi.fn(),
    });
    return {
      noble,
      notify,
      peripheral,
      setPaired(value) { paired = value; },
      write,
    };
  }

  it('supplies the Windows PIN and reconnects after the bonding disconnect', async () => {
    const transport = fakeTransport();
    const backend = await createNobleBackend('win32', { noble: transport.noble });
    await backend.startScan(() => undefined);
    transport.noble.emit('discover', transport.peripheral);

    const persistentDeviceId = await backend.pair(transport.peripheral.id, async () => '123456');

    expect(transport.peripheral.pairAsync).toHaveBeenCalledWith({ pin: '123456' });
    expect(transport.peripheral.connectAsync).toHaveBeenCalledTimes(2);
    expect(transport.notify.subscribeAsync).toHaveBeenCalled();
    expect(persistentDeviceId).toBe('aabbccddeeff');
    await backend.dispose();
  });

  it('retries without a stage timeout when native discovery reports a stale connection', async () => {
    const transport = fakeTransport();
    transport.peripheral.pairAsync.mockImplementation(async () => {
      transport.setPaired(true);
      transport.peripheral.state = 'connected';
    });
    transport.peripheral.discoverSomeServicesAndCharacteristicsAsync
      .mockRejectedValueOnce(new Error('device not connected while discovering services'));
    const backend = await createNobleBackend('win32', { noble: transport.noble });
    await backend.startScan(() => undefined);
    transport.noble.emit('discover', transport.peripheral);

    await backend.pair(transport.peripheral.id, async () => '123456');

    expect(transport.peripheral.disconnectAsync).toHaveBeenCalled();
    expect(transport.peripheral.connectAsync).toHaveBeenCalledTimes(2);
    expect(transport.notify.subscribeAsync).toHaveBeenCalled();
    await backend.dispose();
  }, 10_000);

  it('does not retry native service authorization after pairing is rejected', async () => {
    const transport = fakeTransport();
    transport.notify.subscribeAsync.mockRejectedValue(new Error('Encryption is insufficient'));
    const backend = await createNobleBackend('darwin', { noble: transport.noble });
    await backend.startScan(() => undefined);
    transport.noble.emit('discover', transport.peripheral);

    await expect(backend.pair(transport.peripheral.id, vi.fn()))
      .rejects.toThrow('Encryption is insufficient');

    expect(transport.notify.subscribeAsync).toHaveBeenCalledTimes(1);
    expect(transport.peripheral.connectAsync).toHaveBeenCalledTimes(1);
    await backend.dispose();
  }, 10_000);

  it('uses the BlueZ agent for Linux PIN pairing', async () => {
    const transport = fakeTransport();
    const pairLinux = vi.fn().mockResolvedValue(undefined);
    const requestPin = vi.fn().mockResolvedValue('654321');
    const backend = await createNobleBackend('linux', {
      noble: transport.noble,
      pairLinuxBluetoothDevice: pairLinux,
    });
    await backend.startScan(() => undefined);
    transport.noble.emit('discover', transport.peripheral);

    await backend.pair(transport.peripheral.id, requestPin);

    expect(pairLinux).toHaveBeenCalledWith('AA:BB:CC:DD:EE:FF', requestPin);
    expect(requestPin).not.toHaveBeenCalled();
    await backend.dispose();
  });

  it('does not request the Windows PIN again when WinRT reports a durable bond', async () => {
    const transport = fakeTransport();
    transport.setPaired(true);
    const requestPin = vi.fn().mockResolvedValue('123456');
    const backend = await createNobleBackend('win32', { noble: transport.noble });
    await backend.startScan(() => undefined);
    transport.noble.emit('discover', transport.peripheral);

    await backend.pair(transport.peripheral.id, requestPin);

    expect(requestPin).not.toHaveBeenCalled();
    expect(transport.peripheral.pairAsync).not.toHaveBeenCalled();
    expect(transport.notify.subscribeAsync).toHaveBeenCalled();
    await backend.dispose();
  });

  it('rediscovers the saved Windows address before a cold-start connection', async () => {
    const transport = fakeTransport();
    transport.noble.startScanningAsync.mockImplementation(async () => {
      queueMicrotask(() => transport.noble.emit('discover', transport.peripheral));
    });
    const backend = await createNobleBackend('win32', { noble: transport.noble });

    await backend.open('rnode-one', transport.peripheral.id, {
      onData: vi.fn(),
      onClosed: vi.fn(),
    });

    expect(transport.noble.startScanningAsync).toHaveBeenCalledWith(
      ['6e400001b5a3f393e0a9e50e24dcca9e'],
      true,
    );
    expect(transport.peripheral.connectAsync).toHaveBeenCalled();
    expect(transport.noble.connectAsync).not.toHaveBeenCalled();
    await backend.dispose();
  });

  it('rediscovers the saved address before reopening a durable Windows device', async () => {
    const transport = fakeTransport();
    const persistentDeviceId = 'aabbccddeeff';
    transport.noble.startScanningAsync.mockImplementation(async () => {
      queueMicrotask(() => transport.noble.emit('discover', transport.peripheral));
    });
    const backend = await createNobleBackend('win32', { noble: transport.noble });

    await backend.open('rnode-one', persistentDeviceId, {
      onData: vi.fn(),
      onClosed: vi.fn(),
    });

    expect(transport.noble.startScanningAsync).toHaveBeenCalled();
    expect(transport.peripheral.connectAsync).toHaveBeenCalled();
    expect(transport.noble.connectAsync).not.toHaveBeenCalled();
    expect(transport.notify.subscribeAsync).toHaveBeenCalled();
    await backend.dispose();
  });

  it('retries the complete durable Windows GATT open after a stale session', async () => {
    const transport = fakeTransport();
    const persistentDeviceId = 'aabbccddeeff';
    transport.noble.startScanningAsync.mockImplementation(async () => {
      queueMicrotask(() => transport.noble.emit('discover', transport.peripheral));
    });
    transport.peripheral.discoverSomeServicesAndCharacteristicsAsync
      .mockRejectedValueOnce(new Error('Device is unreachable while discovering services'));
    const backend = await createNobleBackend('win32', { noble: transport.noble });

    await backend.open('rnode-one', persistentDeviceId, {
      onData: vi.fn(),
      onClosed: vi.fn(),
    });

    expect(transport.peripheral.connectAsync).toHaveBeenCalledTimes(2);
    expect(transport.peripheral.disconnectAsync).toHaveBeenCalledTimes(1);
    expect(transport.notify.subscribeAsync).toHaveBeenCalled();
    await backend.dispose();
  }, 10_000);

  it('does not hang when Windows omits scan-stop completion', async () => {
    vi.useFakeTimers();
    try {
      const transport = fakeTransport();
      const persistentDeviceId = 'aabbccddeeff';
      transport.noble.startScanningAsync.mockImplementation(async () => {
        queueMicrotask(() => transport.noble.emit('discover', transport.peripheral));
      });
      transport.noble.stopScanningAsync.mockReturnValue(new Promise(() => undefined));
      const backend = await createNobleBackend('win32', { noble: transport.noble });

      const opening = backend.open('rnode-one', persistentDeviceId, {
        onData: vi.fn(),
        onClosed: vi.fn(),
      });
      await vi.advanceTimersByTimeAsync(6_000);
      await opening;

      expect(transport.peripheral.connectAsync).toHaveBeenCalled();
      expect(transport.notify.subscribeAsync).toHaveBeenCalled();
      await backend.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it('silently resolves a saved identifier, subscribes, and chunks RNode writes', async () => {
    const transport = fakeTransport();
    transport.noble.startScanningAsync.mockImplementation(async () => {
      queueMicrotask(() => transport.noble.emit('discover', transport.peripheral));
    });
    const backend = await createNobleBackend('darwin', { noble: transport.noble });
    const onData = vi.fn();
    const onClosed = vi.fn();
    await backend.open('rnode-one', transport.peripheral.id, { onData, onClosed });

    transport.notify.emit('data', Buffer.from([1, 2, 3]), true);
    expect(onData).toHaveBeenCalledWith(Uint8Array.of(1, 2, 3));
    await backend.write('rnode-one', Uint8Array.from({ length: 45 }, (_, index) => index));
    expect(transport.write.writeAsync).toHaveBeenCalledTimes(3);
    expect(Array.from(transport.write.writeAsync.mock.calls[2][0])).toEqual([40, 41, 42, 43, 44]);

    transport.peripheral.emit('disconnect');
    expect(onClosed).toHaveBeenCalledTimes(1);
    await backend.dispose();
  });

  it('cancels a pending protected service open without starting another attempt', async () => {
    vi.useFakeTimers();
    try {
      const transport = fakeTransport();
      let rejectSubscription;
      transport.notify.subscribeAsync.mockReturnValue(new Promise((_resolve, reject) => {
        rejectSubscription = reject;
      }));
      transport.peripheral.disconnectAsync.mockImplementation(async () => {
        transport.peripheral.state = 'disconnected';
        rejectSubscription?.(new Error('Peripheral disconnected'));
      });
      transport.noble.startScanningAsync.mockImplementation(async () => {
        queueMicrotask(() => transport.noble.emit('discover', transport.peripheral));
      });
      const backend = await createNobleBackend('darwin', { noble: transport.noble });

      const opening = backend.open('rnode-one', transport.peripheral.id, {
        onData: vi.fn(),
        onClosed: vi.fn(),
      });
      await vi.advanceTimersByTimeAsync(750);
      expect(transport.notify.subscribeAsync).toHaveBeenCalledTimes(1);

      await backend.close('rnode-one');
      await expect(opening).rejects.toThrow('Peripheral disconnected');
      await vi.advanceTimersByTimeAsync(30_000);

      expect(transport.notify.subscribeAsync).toHaveBeenCalledTimes(1);
      expect(transport.peripheral.disconnectAsync).toHaveBeenCalled();
      await backend.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it('rediscovers a macOS RNode when the saved native peripheral becomes stale', async () => {
    const transport = fakeTransport();
    transport.noble.startScanningAsync.mockImplementation(async () => {
      queueMicrotask(() => transport.noble.emit('discover', transport.peripheral));
    });
    const backend = await createNobleBackend('darwin', { noble: transport.noble });
    try {
      const firstClosed = vi.fn();
      await backend.open('rnode-one', transport.peripheral.id, {
        onData: vi.fn(),
        onClosed: firstClosed,
      });
      transport.peripheral.state = 'disconnected';
      transport.peripheral.emit('disconnect');
      expect(firstClosed).toHaveBeenCalledOnce();

      await backend.open('rnode-one', transport.peripheral.id, {
        onData: vi.fn(),
        onClosed: vi.fn(),
      });

      expect(transport.noble.startScanningAsync).toHaveBeenCalledTimes(2);
      expect(transport.noble.startScanningAsync).toHaveBeenLastCalledWith(
        ['6e400001b5a3f393e0a9e50e24dcca9e'],
        true,
      );
      expect(transport.noble.connectAsync).not.toHaveBeenCalled();
      expect(transport.peripheral.connectAsync).toHaveBeenCalledTimes(2);
      expect(transport.notify.subscribeAsync).toHaveBeenCalledTimes(2);
    } finally {
      await backend.dispose();
    }
  });

  it('removes stale generation listeners before reconnecting the same macOS peripheral', async () => {
    const transport = fakeTransport();
    transport.noble.startScanningAsync.mockImplementation(async () => {
      queueMicrotask(() => transport.noble.emit('discover', transport.peripheral));
    });
    const backend = await createNobleBackend('darwin', { noble: transport.noble });
    try {
      const firstClosed = vi.fn();
      const secondClosed = vi.fn();
      await backend.open('rnode-one', transport.peripheral.id, {
        onData: vi.fn(),
        onClosed: firstClosed,
      });
      expect(transport.peripheral.listenerCount('disconnect')).toBe(1);
      expect(transport.notify.listenerCount('data')).toBe(1);

      transport.peripheral.state = 'disconnected';
      transport.peripheral.emit('disconnect');
      expect(firstClosed).toHaveBeenCalledOnce();
      expect(transport.peripheral.listenerCount('disconnect')).toBe(0);
      expect(transport.notify.listenerCount('data')).toBe(0);

      await backend.open('rnode-one', transport.peripheral.id, {
        onData: vi.fn(),
        onClosed: secondClosed,
      });
      expect(transport.peripheral.listenerCount('disconnect')).toBe(1);
      expect(transport.notify.listenerCount('data')).toBe(1);

      transport.peripheral.state = 'disconnected';
      transport.peripheral.emit('disconnect');
      expect(firstClosed).toHaveBeenCalledOnce();
      expect(secondClosed).toHaveBeenCalledOnce();
      expect(transport.peripheral.listenerCount('disconnect')).toBe(0);
      expect(transport.notify.listenerCount('data')).toBe(0);
    } finally {
      await backend.dispose();
    }
  });
});
