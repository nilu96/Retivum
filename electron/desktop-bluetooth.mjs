import { createRequire } from 'node:module';
import { pairLinuxBluetoothDevice } from './linux-bluetooth-pairing.mjs';

const require = createRequire(import.meta.url);
const SCAN_START_CHANNEL = 'retivum:ble:scan-start';
const SCAN_STOP_CHANNEL = 'retivum:ble:scan-stop';
const PAIR_CHANNEL = 'retivum:ble:pair';
const CONNECTED_DEVICES_CHANNEL = 'retivum:ble:connected-devices';
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
const BLE_REDISCOVERY_TIMEOUT_MS = 8_000;
const WINDOWS_SCAN_STOP_TIMEOUT_MS = 5_000;
const DISCONNECT_TIMEOUT_MS = 5_000;
const POST_CONNECT_SETTLE_MS = 750;
const PAIRING_RECONNECT_ATTEMPTS = 5;
const PAIRING_RECONNECT_DELAY_MS = 3_500;
const WINDOWS_OPEN_ATTEMPTS = 5;
const OTHER_OPEN_ATTEMPTS = 3;

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
    try {
      const persistentDeviceId = await (await getBackend()).pair(deviceId, async () => {
        const response = await requestPairing({
          deviceId,
          pairingKind: 'providePin',
        });
        if (!response.confirmed || !validPin(response.pin)) throw new Error('RNODE_BLE_PAIRING_CANCELLED');
        return response.pin;
      });
      return { deviceId: validDeviceId(persistentDeviceId ?? deviceId) };
    } catch (error) {
      throw stablePairingError(error);
    }
  });

  ipcMain.handle(CONNECTED_DEVICES_CHANNEL, async (event) => {
    assertTrusted(event);
    return Array.from(new Set(
      Array.from(connections.values())
        .filter((entry) => entry.ownerId === event.sender.id && entry.connected)
        .map((entry) => entry.deviceId),
    ));
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
    const entry = { ownerId: owner.id, deviceId, connected: false };
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
      if (connections.get(id) === entry) entry.connected = true;
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
    ipcMain.removeHandler(CONNECTED_DEVICES_CHANNEL);
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
  const openings = new Map();
  let scanListener;
  let nativeScanActive = false;
  const adapterStateListener = (state) => {
    if (state !== 'poweredOn') discovered.clear();
  };
  noble.on('stateChange', adapterStateListener);

  function rememberPeripheral(peripheral, requestedId) {
    discovered.set(peripheral.id, peripheral);
    discovered.set(normalizeDeviceId(peripheral.id), peripheral);
    const address = normalizeDeviceId(peripheral.address);
    if (address && address !== 'unknown') discovered.set(address, peripheral);
    if (requestedId) discovered.set(requestedId, peripheral);
  }

  function forgetPeripheral(peripheral, requestedId) {
    for (const [key, candidate] of discovered) {
      if (candidate === peripheral || key === requestedId || normalizeDeviceId(key) === normalizeDeviceId(requestedId)) {
        discovered.delete(key);
      }
    }
  }

  function findPeripheral(deviceId) {
    const normalizedId = normalizeDeviceId(deviceId);
    return discovered.get(deviceId)
      ?? discovered.get(normalizedId)
      ?? Array.from(new Set(discovered.values())).find((peripheral) => (
        normalizeDeviceId(peripheral.id) === normalizedId
          || normalizeDeviceId(peripheral.address) === normalizedId
      ));
  }

  function logReconnectStage(deviceId, stageName) {
    if (platform === 'win32' && windowsDeviceAddress(deviceId)) {
      console.info('RETIVUM_BLE_RECONNECT_STAGE', { stage: stageName });
    }
  }

  async function ready() {
    await stage('Bluetooth adapter', () => noble.waitForPoweredOnAsync(STAGE_TIMEOUT_MS));
  }

  async function startScan(onDevice) {
    await ready();
    await stopNativeScan();
    if (scanListener) noble.removeListener('discover', scanListener);
    scanListener = (peripheral) => {
      const services = peripheral.advertisement?.serviceUuids?.map(normalizeUuid) ?? [];
      if (services.length > 0 && !services.includes(RNODE_NUS_SERVICE)) return;
      rememberPeripheral(peripheral);
      onDevice({
        id: peripheral.id,
        name: peripheral.advertisement?.localName || 'RNode',
        detail: typeof peripheral.rssi === 'number' ? `${peripheral.rssi} dBm` : undefined,
      });
    };
    noble.on('discover', scanListener);
    nativeScanActive = true;
    try {
      await stage('Bluetooth scan', () => noble.startScanningAsync([RNODE_NUS_SERVICE], true));
    } catch (error) {
      await stopNativeScan();
      throw error;
    }
  }

  async function stopScan() {
    if (scanListener) noble.removeListener('discover', scanListener);
    scanListener = undefined;
    await stopNativeScan();
  }

  async function stopNativeScan() {
    if (!nativeScanActive || noble.state !== 'poweredOn') {
      nativeScanActive = false;
      return;
    }
    nativeScanActive = false;
    await stage(
      'stop Bluetooth scan',
      () => noble.stopScanningAsync(),
      WINDOWS_SCAN_STOP_TIMEOUT_MS,
    ).catch(() => undefined);
  }

  async function rediscoverPeripheral(deviceId) {
    let resolveMatch;
    const match = new Promise((resolve) => { resolveMatch = resolve; });
    const listener = (peripheral) => {
      const services = peripheral.advertisement?.serviceUuids?.map(normalizeUuid) ?? [];
      if (services.length > 0 && !services.includes(RNODE_NUS_SERVICE)) return;
      rememberPeripheral(peripheral);
      if (
        normalizeDeviceId(peripheral.id) === normalizeDeviceId(deviceId)
        || normalizeDeviceId(peripheral.address) === normalizeDeviceId(deviceId)
      ) resolveMatch(peripheral);
    };
    noble.on('discover', listener);
    try {
      nativeScanActive = true;
      await stage('Bluetooth scan', () => noble.startScanningAsync([RNODE_NUS_SERVICE], true));
      return await stage(
        'rediscover paired RNode',
        () => match,
        BLE_REDISCOVERY_TIMEOUT_MS,
      ).catch(() => undefined);
    } finally {
      noble.removeListener('discover', listener);
      await stopNativeScan();
    }
  }

  async function resolveAndConnect(deviceId, forceRediscovery = false) {
    logReconnectStage(deviceId, 'adapter');
    await ready();
    logReconnectStage(deviceId, 'stop-scan');
    await stopScan();
    const savedAddress = windowsDeviceAddress(deviceId);
    logReconnectStage(deviceId, 'rediscover');
    const known = forceRediscovery
      ? await rediscoverPeripheral(savedAddress ?? deviceId)
      : findPeripheral(deviceId) ?? (savedAddress ? findPeripheral(savedAddress) : undefined);
    if (known) {
      logReconnectStage(deviceId, 'connect-scanned-device');
      if (known.state !== 'connected') await stage('connect', () => known.connectAsync());
      rememberPeripheral(known, deviceId);
      return known;
    }
    logReconnectStage(deviceId, 'connect-saved-device');
    const peripheral = await stage('connect', () => noble.connectAsync(savedAddress ?? deviceId));
    if (!peripheral) throw new Error('RNODE_BLE_DEVICE_NOT_FOUND');
    rememberPeripheral(peripheral, deviceId);
    return peripheral;
  }

  async function disconnectPeripheral(peripheral) {
    if (peripheral?.state === 'connected' || peripheral?.state === 'disconnecting') {
      await stage('disconnect', () => peripheral.disconnectAsync(), DISCONNECT_TIMEOUT_MS).catch(() => undefined);
    } else if (peripheral?.state === 'connecting') {
      peripheral.cancelConnect?.();
    }
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
          if (isTerminalPairingError(error)) break;
          if (attempt < PAIRING_RECONNECT_ATTEMPTS) await sleep(PAIRING_RECONNECT_DELAY_MS);
        }
      }
      if (lastError) throw lastError;
      if (platform === 'win32') {
        persistentDeviceId = windowsDeviceAddress(connected.address)
          ?? windowsDeviceAddress(connected.id)
          ?? windowsDeviceAddress(deviceId);
        if (!persistentDeviceId) throw new Error('Windows durable device address unavailable');
      }
      return persistentDeviceId;
    } finally {
      const current = discovered.get(deviceId);
      await disconnectPeripheral(current);
      if (current) forgetPeripheral(current, deviceId);
    }
  }

  async function open(id, deviceId, hooks) {
    await close(id);
    const opening = { deviceId, peripheral: undefined, cancelled: false };
    openings.set(id, opening);
    const durableWindowsDevice = platform === 'win32' && windowsDeviceAddress(deviceId) !== undefined;
    const attempts = durableWindowsDevice ? WINDOWS_OPEN_ATTEMPTS : OTHER_OPEN_ATTEMPTS;
    let lastError;
    if (durableWindowsDevice) console.info('RETIVUM_BLE_RECONNECT_START');
    try {
      for (let attempt = 1; attempt <= attempts; attempt += 1) {
        if (opening.cancelled) throw new Error('RNODE_BLE_CONNECTION_CANCELLED');
        let peripheral;
        let disconnected;
        try {
          // Always obtain a current Noble Peripheral before opening GATT. Noble
          // can discard its internal peripheral while our durable device ID and
          // cached wrapper survive an adapter reset or unexpected disconnect.
          peripheral = await resolveAndConnect(deviceId, true);
          opening.peripheral = peripheral;
          if (opening.cancelled) throw new Error('RNODE_BLE_CONNECTION_CANCELLED');
          disconnected = () => {
            const entry = connections.get(id);
            if (!entry
              || entry.peripheral !== peripheral
              || entry.disconnected !== disconnected
              || entry.closing) return;
            connections.delete(id);
            // Noble can reuse a Peripheral wrapper after reconnecting. Remove
            // every listener owned by this generation before notifying the
            // renderer so a later disconnect cannot be handled by the obsolete
            // session and close its replacement.
            peripheral.removeListener('disconnect', disconnected);
            entry.notify.removeListener('data', entry.listener);
            forgetPeripheral(peripheral, deviceId);
            hooks.onClosed();
          };
          peripheral.on('disconnect', disconnected);
          if (durableWindowsDevice) console.info('RETIVUM_BLE_RECONNECT_STAGE', { stage: 'discover-nus' });
          const nus = await discoverNus(peripheral, hooks.onData);
          if (opening.cancelled) {
            nus.notify.removeListener('data', nus.listener);
            await nus.notify.unsubscribeAsync().catch(() => undefined);
            throw new Error('RNODE_BLE_CONNECTION_CANCELLED');
          }
          connections.set(id, { peripheral, disconnected, ...nus, closing: false });
          if (durableWindowsDevice) console.info('RETIVUM_BLE_RECONNECT_READY', { attempt });
          return;
        } catch (error) {
          lastError = error;
          if (peripheral && disconnected) peripheral.removeListener('disconnect', disconnected);
          if (peripheral?.state === 'connected' || peripheral?.state === 'disconnecting' || peripheral?.state === 'connecting') {
            await disconnectPeripheral(peripheral);
          } else {
            try { noble.cancelConnect?.(windowsDeviceAddress(deviceId) ?? deviceId); } catch { /* no pending native connection */ }
          }
          if (peripheral) forgetPeripheral(peripheral, deviceId);
          else discovered.delete(deviceId);
          if (opening.cancelled || attempt >= attempts) break;
          if (durableWindowsDevice) console.warn('RETIVUM_BLE_RECONNECT_RETRY', {
            attempt,
            message: error instanceof Error ? error.message : String(error),
          });
          await sleep(PAIRING_RECONNECT_DELAY_MS);
        } finally {
          opening.peripheral = undefined;
        }
      }
      throw lastError instanceof Error ? lastError : new Error('RNODE_BLE_CONNECTION_FAILED');
    } finally {
      if (openings.get(id) === opening) openings.delete(id);
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
    const opening = openings.get(id);
    if (opening) {
      opening.cancelled = true;
      openings.delete(id);
      const peripheral = opening.peripheral ?? findPeripheral(opening.deviceId);
      if (peripheral) await disconnectPeripheral(peripheral);
      else {
        try { noble.cancelConnect?.(windowsDeviceAddress(opening.deviceId) ?? opening.deviceId); } catch { /* no pending native connection */ }
      }
    }
    const entry = connections.get(id);
    if (!entry) return;
    connections.delete(id);
    entry.closing = true;
    entry.notify.removeListener('data', entry.listener);
    entry.peripheral.removeListener('disconnect', entry.disconnected);
    await entry.notify.unsubscribeAsync().catch(() => undefined);
    await disconnectPeripheral(entry.peripheral);
    forgetPeripheral(entry.peripheral);
  }

  async function dispose() {
    await stopScan();
    for (const id of Array.from(openings.keys())) await close(id);
    noble.removeListener('stateChange', adapterStateListener);
    discovered.clear();
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

function windowsDeviceAddress(value) {
  const address = normalizeDeviceId(value);
  return /^[0-9a-f]{12}$/.test(address) ? address : undefined;
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

function stablePairingError(error) {
  if (isTerminalPairingError(error)) return new Error('RNODE_BLE_PAIRING_FAILED');
  return stableBluetoothError(error);
}

function isTerminalPairingError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return /RNODE_BLE_PAIRING_CANCELLED|cancel(?:led|ed)|(?:wrong|incorrect)\s*(?:pin|passkey)|(?:pin|passkey).*(?:did not match|mismatch|failed|rejected)|auth(?:entication)?.*(?:failed|rejected|cancel)|(?:pairing|bonding) failed|encryption is insufficient|insufficient (?:authentication|encryption)|pin or key missing|permission denied/i.test(message);
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
