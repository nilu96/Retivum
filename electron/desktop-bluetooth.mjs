import { createRequire } from 'node:module';
import { pairLinuxBluetoothDevice } from './linux-bluetooth-pairing.mjs';

const require = createRequire(import.meta.url);
const SCAN_START_CHANNEL = 'retivum:ble:scan-start';
const SCAN_STOP_CHANNEL = 'retivum:ble:scan-stop';
const PAIR_CHANNEL = 'retivum:ble:pair';
const OPEN_CHANNEL = 'retivum:ble:open';
const WRITE_CHANNEL = 'retivum:ble:write';
const CLOSE_CHANNEL = 'retivum:ble:close';
const EVENT_CHANNEL = 'retivum:ble:event';
const RNODE_NUS_SERVICE = '6e400001b5a3f393e0a9e50e24dcca9e';
const RNODE_NUS_WRITE = '6e400002b5a3f393e0a9e50e24dcca9e';
const RNODE_NUS_NOTIFY = '6e400003b5a3f393e0a9e50e24dcca9e';
const BLE_WRITE_CHUNK_SIZE = 20;
const MAX_WRITE_BYTES = 4 * 1024;
const STAGE_TIMEOUT_MS = 20_000;
const PAIRING_TIMEOUT_MS = 60_000;
const POST_CONNECT_SETTLE_MS = 750;
const PAIRING_RECONNECT_ATTEMPTS = 5;
const PAIRING_RECONNECT_DELAY_MS = 3_500;

export function registerDesktopBluetooth(
  ipcMain,
  isTrustedSender,
  requestPairing,
  createBackend = () => createNobleBackend(),
) {
  let backend;
  let scanOwner;
  const connections = new Map();

  function assertTrusted(event) {
    if (!isTrustedSender(event.senderFrame)) throw new Error('UNTRUSTED_IPC_SENDER');
  }

  async function getBackend() {
    backend ??= await createBackend();
    return backend;
  }

  async function close(id, ownerId) {
    const entry = connections.get(id);
    if (!entry || (ownerId !== undefined && entry.ownerId !== ownerId)) return;
    connections.delete(id);
    await (await getBackend()).close(id);
  }

  ipcMain.handle(SCAN_START_CHANNEL, async (event) => {
    assertTrusted(event);
    if (scanOwner && scanOwner !== event.sender) throw new Error('RNODE_BLE_SCAN_BUSY');
    scanOwner = event.sender;
    await (await getBackend()).startScan((device) => {
      if (!scanOwner || scanOwner.isDestroyed()) return;
      scanOwner.send(EVENT_CHANNEL, { type: 'device', device: sanitizeDevice(device) });
    });
  });

  ipcMain.handle(SCAN_STOP_CHANNEL, async (event) => {
    assertTrusted(event);
    if (scanOwner?.id !== event.sender.id) return;
    scanOwner = undefined;
    await (await getBackend()).stopScan();
  });

  ipcMain.handle(PAIR_CHANNEL, async (event, options) => {
    assertTrusted(event);
    const deviceId = validDeviceId(options?.deviceId);
    await (await getBackend()).pair(deviceId, async () => {
      const response = await requestPairing({
        deviceId,
        pairingKind: 'providePin',
      });
      if (!response.confirmed || !validPin(response.pin)) throw new Error('RNODE_BLE_PAIRING_CANCELLED');
      return response.pin;
    });
  });

  ipcMain.handle(OPEN_CHANNEL, async (event, options) => {
    assertTrusted(event);
    const id = validId(options?.id);
    const deviceId = validDeviceId(options?.deviceId);
    for (const [activeId, entry] of connections) {
      if (activeId !== id && entry.deviceId === deviceId) throw new Error('RNODE_BLE_DEVICE_IN_USE');
    }
    await close(id);
    const owner = event.sender;
    const entry = { ownerId: owner.id, deviceId };
    connections.set(id, entry);
    try {
      await (await getBackend()).open(id, deviceId, {
        onData(data) {
          if (connections.get(id) !== entry || owner.isDestroyed()) return;
          owner.send(EVENT_CHANNEL, { id, type: 'data', data: Array.from(data) });
        },
        onClosed(errorCode) {
          if (connections.get(id) !== entry) return;
          connections.delete(id);
          if (!owner.isDestroyed()) owner.send(EVENT_CHANNEL, {
            id,
            type: errorCode ? 'error' : 'closed',
            ...(errorCode ? { errorCode } : {}),
          });
        },
      });
    } catch (error) {
      if (connections.get(id) === entry) connections.delete(id);
      await (await getBackend()).close(id).catch(() => undefined);
      throw stableBluetoothError(error);
    }
  });

  ipcMain.handle(WRITE_CHANNEL, async (event, options) => {
    assertTrusted(event);
    const id = validId(options?.id);
    const entry = connections.get(id);
    if (!entry || entry.ownerId !== event.sender.id) throw new Error('RNODE_BLE_NOT_OPEN');
    const data = validBytes(options?.data);
    await (await getBackend()).write(id, data);
  });

  ipcMain.handle(CLOSE_CHANNEL, async (event, options) => {
    assertTrusted(event);
    await close(validId(options?.id), event.sender.id);
  });

  return async () => {
    ipcMain.removeHandler(SCAN_START_CHANNEL);
    ipcMain.removeHandler(SCAN_STOP_CHANNEL);
    ipcMain.removeHandler(PAIR_CHANNEL);
    ipcMain.removeHandler(OPEN_CHANNEL);
    ipcMain.removeHandler(WRITE_CHANNEL);
    ipcMain.removeHandler(CLOSE_CHANNEL);
    scanOwner = undefined;
    if (!backend) return;
    await backend.stopScan().catch(() => undefined);
    for (const id of Array.from(connections.keys())) await backend.close(id).catch(() => undefined);
    connections.clear();
    await backend.dispose().catch(() => undefined);
  };
}

export async function createNobleBackend(platform = process.platform, dependencies = {}) {
  const withBindings = dependencies.withBindings
    ?? require('@stoprocent/noble/lib/resolve-bindings');
  const noble = dependencies.noble
    ?? (platform === 'linux' ? withBindings('dbus') : withBindings('default'));
  const linuxPair = dependencies.pairLinuxBluetoothDevice ?? pairLinuxBluetoothDevice;
  const discovered = new Map();
  const connections = new Map();
  let scanListener;

  async function ready() {
    await stage('Bluetooth adapter', () => noble.waitForPoweredOnAsync(STAGE_TIMEOUT_MS));
  }

  async function startScan(onDevice) {
    await ready();
    if (scanListener) noble.removeListener('discover', scanListener);
    scanListener = (peripheral) => {
      const services = peripheral.advertisement?.serviceUuids?.map(normalizeUuid) ?? [];
      if (services.length > 0 && !services.includes(RNODE_NUS_SERVICE)) return;
      discovered.set(peripheral.id, peripheral);
      onDevice({
        id: peripheral.id,
        name: peripheral.advertisement?.localName || 'RNode',
        detail: typeof peripheral.rssi === 'number' ? `${peripheral.rssi} dBm` : undefined,
      });
    };
    noble.on('discover', scanListener);
    await stage('Bluetooth scan', () => noble.startScanningAsync([RNODE_NUS_SERVICE], true));
  }

  async function stopScan() {
    if (scanListener) noble.removeListener('discover', scanListener);
    scanListener = undefined;
    if (noble.state === 'poweredOn') await noble.stopScanningAsync();
  }

  async function resolveAndConnect(deviceId) {
    await ready();
    await stopScan();
    const known = discovered.get(deviceId);
    if (known) {
      if (known.state !== 'connected') await stage('connect', () => known.connectAsync());
      return known;
    }
    const peripheral = await stage('connect', () => noble.connectAsync(deviceId));
    if (!peripheral) throw new Error('RNODE_BLE_DEVICE_NOT_FOUND');
    discovered.set(deviceId, peripheral);
    return peripheral;
  }

  async function discoverNus(peripheral, onData) {
    await sleep(POST_CONNECT_SETTLE_MS);
    const result = await stage('discover RNode UART service', () => (
      peripheral.discoverSomeServicesAndCharacteristicsAsync(
        [RNODE_NUS_SERVICE],
        [RNODE_NUS_WRITE, RNODE_NUS_NOTIFY],
      )
    ));
    const write = result.characteristics.find((item) => normalizeUuid(item.uuid) === RNODE_NUS_WRITE);
    const notify = result.characteristics.find((item) => normalizeUuid(item.uuid) === RNODE_NUS_NOTIFY);
    if (!write || !notify) throw new Error('RNODE_BLE_NUS_UNAVAILABLE');
    const listener = (data, isNotification) => {
      if (isNotification !== false && data?.length) onData?.(Uint8Array.from(data));
    };
    notify.on('data', listener);
    try {
      await stage('subscribe to RNode UART', () => notify.subscribeAsync(), PAIRING_TIMEOUT_MS);
    } catch (error) {
      notify.removeListener('data', listener);
      throw error;
    }
    return { write, notify, listener };
  }

  async function pair(deviceId, requestPin) {
    const peripheral = discovered.get(deviceId);
    if (!peripheral) throw new Error('RNODE_BLE_DEVICE_NOT_FOUND');
    let pin;
    try {
      if (platform === 'win32' || platform === 'linux') pin = await requestPin();
      if (platform === 'linux') {
        await stage('pair', () => linuxPair(peripheral.address, pin), PAIRING_TIMEOUT_MS);
      }
      const connected = await resolveAndConnect(deviceId);
      if (platform === 'win32') {
        await stage('pair', () => connected.pairAsync({ pin }), PAIRING_TIMEOUT_MS);
      }
      let lastError;
      for (let attempt = 1; attempt <= PAIRING_RECONNECT_ATTEMPTS; attempt += 1) {
        try {
          const readyPeripheral = connected.state === 'connected'
            ? connected
            : await resolveAndConnect(deviceId);
          const nus = await discoverNus(readyPeripheral);
          nus.notify.removeListener('data', nus.listener);
          await nus.notify.unsubscribeAsync().catch(() => undefined);
          lastError = undefined;
          break;
        } catch (error) {
          lastError = error;
          const current = discovered.get(deviceId);
          if (current?.state === 'connected') await current.disconnectAsync().catch(() => undefined);
          if (attempt < PAIRING_RECONNECT_ATTEMPTS) await sleep(PAIRING_RECONNECT_DELAY_MS);
        }
      }
      if (lastError) throw lastError;
    } finally {
      const current = discovered.get(deviceId);
      if (current?.state === 'connected') await current.disconnectAsync().catch(() => undefined);
    }
  }

  async function open(id, deviceId, hooks) {
    await close(id);
    const peripheral = await resolveAndConnect(deviceId);
    const disconnected = () => {
      const entry = connections.get(id);
      if (!entry || entry.peripheral !== peripheral || entry.closing) return;
      connections.delete(id);
      hooks.onClosed();
    };
    peripheral.on('disconnect', disconnected);
    try {
      const nus = await discoverNus(peripheral, hooks.onData);
      connections.set(id, { peripheral, disconnected, ...nus, closing: false });
    } catch (error) {
      peripheral.removeListener('disconnect', disconnected);
      await peripheral.disconnectAsync().catch(() => undefined);
      throw error;
    }
  }

  async function write(id, data) {
    const entry = connections.get(id);
    if (!entry) throw new Error('RNODE_BLE_NOT_OPEN');
    for (let offset = 0; offset < data.byteLength; offset += BLE_WRITE_CHUNK_SIZE) {
      const chunk = Buffer.from(data.slice(offset, offset + BLE_WRITE_CHUNK_SIZE));
      await stage('write RNode UART', () => entry.write.writeAsync(chunk, true));
    }
  }

  async function close(id) {
    const entry = connections.get(id);
    if (!entry) return;
    connections.delete(id);
    entry.closing = true;
    entry.notify.removeListener('data', entry.listener);
    entry.peripheral.removeListener('disconnect', entry.disconnected);
    await entry.notify.unsubscribeAsync().catch(() => undefined);
    if (entry.peripheral.state === 'connected') await entry.peripheral.disconnectAsync().catch(() => undefined);
  }

  async function dispose() {
    await stopScan();
    noble.stop();
  }

  return { startScan, stopScan, pair, open, write, close, dispose };
}

function sanitizeDevice(device) {
  return {
    id: validDeviceId(device?.id),
    name: typeof device?.name === 'string' && device.name.trim() ? device.name.trim().slice(0, 128) : 'RNode',
    ...(typeof device?.detail === 'string' ? { detail: device.detail.slice(0, 64) } : {}),
  };
}

function validId(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9-]{1,128}$/.test(value)) throw new Error('RNODE_BLE_INTERFACE_ID_INVALID');
  return value;
}

function validDeviceId(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9:_-]{1,256}$/.test(value)) throw new Error('RNODE_BLE_DEVICE_ID_INVALID');
  return value;
}

function validPin(value) {
  return typeof value === 'string' && /^[0-9]{6}$/.test(value);
}

function validBytes(value) {
  if (!Array.isArray(value) || value.length > MAX_WRITE_BYTES || value.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 255)) {
    throw new Error('RNODE_BLE_DATA_INVALID');
  }
  return Uint8Array.from(value);
}

function normalizeUuid(value) {
  return String(value ?? '').replace(/-/g, '').toLowerCase();
}

async function stage(name, operation, timeoutMs = STAGE_TIMEOUT_MS) {
  let timer;
  try {
    return await Promise.race([
      operation(),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${name} timed out`)), timeoutMs); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function stableBluetoothError(error) {
  const message = error instanceof Error ? error.message : String(error);
  if (/not found|unknown peripheral|invalid peripheral/i.test(message)) return new Error('RNODE_BLE_DEVICE_NOT_FOUND');
  if (/poweredOff|unsupported|adapter/i.test(message)) return new Error('RNODE_BLE_UNAVAILABLE');
  if (/auth|encrypt|pair|permission|denied/i.test(message)) return new Error('RNODE_BLE_PAIRING_REQUIRED');
  if (/NUS|UART service|characteristic/i.test(message)) return new Error('RNODE_BLE_NUS_UNAVAILABLE');
  return new Error('RNODE_BLE_CONNECTION_FAILED');
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
