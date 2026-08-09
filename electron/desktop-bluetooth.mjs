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
const WINDOWS_REDISCOVERY_TIMEOUT_MS = 8_000;
const POST_CONNECT_SETTLE_MS = 750;
const PAIRING_RECONNECT_ATTEMPTS = 5;
const PAIRING_RECONNECT_DELAY_MS = 3_500;
const WINDOWS_OPEN_ATTEMPTS = 5;
// Hex keeps the opaque WinRT DeviceInformation.Id compatible with Noble's
// peripheral-id plumbing, which otherwise accepts only Bluetooth addresses.
// Version 2 also retains the last verified 48-bit advertising address so a
// restart can prefer the same scan-backed connection route as first pairing.
const WINDOWS_DEVICE_ID_V1_PREFIX = '72747677696e01';
const WINDOWS_DEVICE_ID_V2_PREFIX = '72747677696e02';

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
    const persistentDeviceId = await (await getBackend()).pair(deviceId, async () => {
      const response = await requestPairing({
        deviceId,
        pairingKind: 'providePin',
      });
      if (!response.confirmed || !validPin(response.pin)) throw new Error('RNODE_BLE_PAIRING_CANCELLED');
      return response.pin;
    });
    return { deviceId: validDeviceId(persistentDeviceId ?? deviceId) };
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

  async function rediscoverWindowsPeripheral(deviceId) {
    if (platform !== 'win32') return undefined;
    let resolveMatch;
    const match = new Promise((resolve) => { resolveMatch = resolve; });
    const listener = (peripheral) => {
      const services = peripheral.advertisement?.serviceUuids?.map(normalizeUuid) ?? [];
      if (services.length > 0 && !services.includes(RNODE_NUS_SERVICE)) return;
      discovered.set(peripheral.id, peripheral);
      if (normalizeDeviceId(peripheral.id) === normalizeDeviceId(deviceId)) resolveMatch(peripheral);
    };
    noble.on('discover', listener);
    try {
      await stage('Bluetooth scan', () => noble.startScanningAsync([RNODE_NUS_SERVICE], true));
      return await stage(
        'rediscover paired RNode',
        () => match,
        WINDOWS_REDISCOVERY_TIMEOUT_MS,
      ).catch(() => undefined);
    } finally {
      noble.removeListener('discover', listener);
      if (noble.state === 'poweredOn') await noble.stopScanningAsync().catch(() => undefined);
    }
  }

  async function resolveAndConnect(deviceId) {
    await ready();
    await stopScan();
    const savedAddress = windowsDeviceAddress(deviceId);
    const known = discovered.get(deviceId)
      ?? (savedAddress ? discovered.get(savedAddress) : undefined)
      ?? await rediscoverWindowsPeripheral(savedAddress ?? deviceId);
    if (known) {
      if (known.state !== 'connected') await stage('connect', () => known.connectAsync());
      discovered.set(deviceId, known);
      return known;
    }
    const peripheral = await stage('connect', () => noble.connectAsync(directWindowsDeviceId(deviceId)));
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
    let persistentDeviceId = deviceId;
    try {
      if (platform === 'linux') {
        await stage('pair', () => linuxPair(peripheral.address, requestPin), PAIRING_TIMEOUT_MS);
      }
      const connected = await resolveAndConnect(deviceId);
      if (platform === 'win32' && connected.isPaired?.() !== true) {
        const pin = await requestPin();
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
      if (platform === 'win32') {
        const winrtDeviceId = connected.getDeviceId?.();
        if (typeof winrtDeviceId !== 'string' || !winrtDeviceId) {
          throw new Error('Windows durable device identifier unavailable');
        }
        persistentDeviceId = encodeWindowsDeviceId(winrtDeviceId, deviceId);
      }
      return persistentDeviceId;
    } finally {
      const current = discovered.get(deviceId);
      if (current?.state === 'connected') await current.disconnectAsync().catch(() => undefined);
    }
  }

  async function open(id, deviceId, hooks) {
    await close(id);
    const durableWindowsDevice = platform === 'win32' && isWindowsDeviceId(deviceId);
    const attempts = durableWindowsDevice ? WINDOWS_OPEN_ATTEMPTS : 1;
    let lastError;
    if (durableWindowsDevice) console.info('RETIVUM_BLE_RECONNECT_START');
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      let peripheral;
      let disconnected;
      try {
        peripheral = await resolveAndConnect(deviceId);
        disconnected = () => {
          const entry = connections.get(id);
          if (!entry || entry.peripheral !== peripheral || entry.closing) return;
          connections.delete(id);
          hooks.onClosed();
        };
        peripheral.on('disconnect', disconnected);
        const nus = await discoverNus(peripheral, hooks.onData);
        connections.set(id, { peripheral, disconnected, ...nus, closing: false });
        if (durableWindowsDevice) console.info('RETIVUM_BLE_RECONNECT_READY', { attempt });
        return;
      } catch (error) {
        lastError = error;
        if (peripheral && disconnected) peripheral.removeListener('disconnect', disconnected);
        if (peripheral?.state === 'connected') {
          await peripheral.disconnectAsync().catch(() => undefined);
        } else if (peripheral?.state === 'connecting') {
          peripheral.cancelConnect?.();
        } else {
          try { noble.cancelConnect?.(directWindowsDeviceId(deviceId)); } catch { /* no pending native connection */ }
        }
        discovered.delete(deviceId);
        if (!durableWindowsDevice || attempt >= attempts) break;
        console.warn('RETIVUM_BLE_RECONNECT_RETRY', {
          attempt,
          message: error instanceof Error ? error.message : String(error),
        });
        await sleep(PAIRING_RECONNECT_DELAY_MS);
      }
    }
    throw lastError instanceof Error ? lastError : new Error('RNODE_BLE_CONNECTION_FAILED');
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
  if (typeof value !== 'string' || !/^[a-zA-Z0-9:_-]{1,1024}$/.test(value)) throw new Error('RNODE_BLE_DEVICE_ID_INVALID');
  return value;
}

function encodeWindowsDeviceId(value, address) {
  const normalizedAddress = normalizeDeviceId(address);
  if (!/^[0-9a-f]{12}$/.test(normalizedAddress)) {
    throw new Error('Windows durable device address unavailable');
  }
  return `${WINDOWS_DEVICE_ID_V2_PREFIX}${normalizedAddress}${Buffer.from(value, 'utf8').toString('hex')}`;
}

function isWindowsDeviceId(value) {
  return typeof value === 'string'
    && (value.startsWith(WINDOWS_DEVICE_ID_V1_PREFIX) || value.startsWith(WINDOWS_DEVICE_ID_V2_PREFIX));
}

function windowsDeviceAddress(value) {
  if (typeof value !== 'string' || !value.startsWith(WINDOWS_DEVICE_ID_V2_PREFIX)) return undefined;
  const address = value.slice(WINDOWS_DEVICE_ID_V2_PREFIX.length, WINDOWS_DEVICE_ID_V2_PREFIX.length + 12);
  return /^[0-9a-f]{12}$/.test(address) ? address : undefined;
}

function directWindowsDeviceId(value) {
  if (typeof value !== 'string' || !value.startsWith(WINDOWS_DEVICE_ID_V2_PREFIX)) return value;
  return `${WINDOWS_DEVICE_ID_V1_PREFIX}${value.slice(WINDOWS_DEVICE_ID_V2_PREFIX.length + 12)}`;
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

function normalizeDeviceId(value) {
  return String(value ?? '').replace(/:/g, '').toLowerCase();
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
