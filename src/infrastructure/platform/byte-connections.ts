import type { RNodeInterfaceConfig, TcpInterfaceConfig } from '../../domain/settings';
import { Capacitor, type PluginListenerHandle } from '@capacitor/core';
import { BluetoothLowEnergy } from '@capgo/capacitor-bluetooth-low-energy';
import { TCPClient, type TCPConnection } from '@devioarts/capacitor-tcpclient';
import { resolveBluetoothDevice } from './bluetooth-devices';
import {
  initializeNativeBluetooth,
  nativeBluetoothDeviceIsDiscovered,
  rememberNativeBluetoothDevice,
} from './native-bluetooth';

const RNODE_NUS_SERVICE = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
const RNODE_NUS_WRITE = '6e400002-b5a3-f393-e0a9-e50e24dcca9e';
const RNODE_NUS_NOTIFY = '6e400003-b5a3-f393-e0a9-e50e24dcca9e';
// The native plugin keys pending callbacks with the UUID strings supplied by
// JavaScript. CoreBluetooth completes them with uppercase CBUUID strings, so
// native operations must use the same representation or their promises never
// resolve even though the peripheral is connected.
const RNODE_NUS_SERVICE_NATIVE = RNODE_NUS_SERVICE.toUpperCase();
const RNODE_NUS_WRITE_NATIVE = RNODE_NUS_WRITE.toUpperCase();
const RNODE_NUS_NOTIFY_NATIVE = RNODE_NUS_NOTIFY.toUpperCase();
const BLE_CONNECT_ATTEMPTS = 5;
const BLE_RETRY_DELAY_MS = 3_500;
const BLE_POST_CONNECT_SETTLE_MS = 750;
const BLE_PAIRING_TIMEOUT_MS = 45_000;
const BLE_POST_PAIRING_GRACE_MS = 3_500;
const BLE_STAGE_TIMEOUT_MS = 15_000;
const BLE_WRITE_CHUNK_SIZE = 20;
// iOS may hold the first local TCP connection while the user answers the
// Local Network permission sheet. The plugin's three-second default expires
// too quickly for that user-mediated flow.
const TCP_CONNECT_TIMEOUT_MS = 30_000;

export interface ByteConnection {
  open(onData: (data: Uint8Array) => void, onClosed: () => void): Promise<void>;
  write(data: Uint8Array): Promise<void>;
  close(): Promise<void>;
}

export function createRNodeByteConnection(
  config: RNodeInterfaceConfig,
  log: (code: string, details?: Record<string, string | number | boolean>) => void = () => undefined,
): ByteConnection {
  if (config.connection.type !== 'ble') return new SerialByteConnection(config);
  return Capacitor.isNativePlatform()
    ? new NativeBluetoothByteConnection(config, log)
    : new BluetoothByteConnection(config, log);
}

/**
 * Access the secured RNode UART service after device selection. Subscribing to
 * its protected TX characteristic asks CoreBluetooth to present the system
 * passkey sheet. The RNode can disconnect after accepting a new bond, so the
 * regular retry path also has to complete here.
 */
export async function authorizeNativeRNodeDevice(deviceId: string): Promise<void> {
  const connection = new NativeBluetoothByteConnection({
    id: 'native-rnode-authorization',
    schemaVersion: 2,
    type: 'rnode',
    name: 'RNode',
    enabled: false,
    mode: 'full',
    connection: { type: 'ble', deviceId },
    radio: {
      frequency: 869_525_000,
      bandwidth: 125_000,
      txPower: 21,
      spreadingFactor: 8,
      codingRate: 5,
      dutyCycle: 10,
      flowControl: false,
    },
  }, () => undefined, true);
  try {
    await connection.open(() => undefined, () => undefined);
  } finally {
    await connection.close();
  }
}

export function createTcpByteConnection(config: TcpInterfaceConfig): ByteConnection {
  if (window.retivumDesktopSockets || window.retivumMobileSockets) return new NativeSocketByteConnection(config);
  if (Capacitor.isNativePlatform()) return new CapacitorTcpByteConnection(config);
  throw new Error('TCP_BRIDGE_UNAVAILABLE');
}

class SerialByteConnection implements ByteConnection {
  private port?: SerialPort;
  private reader?: ReadableStreamDefaultReader<Uint8Array>;
  private writer?: WritableStreamDefaultWriter<Uint8Array>;
  private closing = false;

  constructor(private readonly config: RNodeInterfaceConfig) {}

  async open(onData: (data: Uint8Array) => void, onClosed: () => void): Promise<void> {
    if (!navigator.serial) throw new Error('RNODE_SERIAL_UNAVAILABLE');
    const ports = await navigator.serial.getPorts();
    this.port = ports.find((port) => {
      const info = port.getInfo();
      return (this.config.connection.usbVendorId === undefined || info.usbVendorId === this.config.connection.usbVendorId)
        && (this.config.connection.usbProductId === undefined || info.usbProductId === this.config.connection.usbProductId);
    });
    if (!this.port) throw new Error('RNODE_SERIAL_NOT_AUTHORIZED');
    await this.port.open({ baudRate: 115_200, dataBits: 8, stopBits: 1, parity: 'none', flowControl: 'none' });
    if (!this.port.readable || !this.port.writable) throw new Error('RNODE_SERIAL_STREAMS_UNAVAILABLE');
    this.reader = this.port.readable.getReader();
    this.writer = this.port.writable.getWriter();
    this.closing = false;
    void this.read(onData, onClosed);
  }

  async write(data: Uint8Array): Promise<void> {
    if (!this.writer) throw new Error('RNODE_SERIAL_NOT_OPEN');
    await this.writer.write(data);
  }

  async close(): Promise<void> {
    this.closing = true;
    try { await this.reader?.cancel(); } catch { /* already closed */ }
    try { this.reader?.releaseLock(); } catch { /* stale lock */ }
    try { this.writer?.releaseLock(); } catch { /* stale lock */ }
    this.reader = undefined;
    this.writer = undefined;
    try { await this.port?.close(); } catch { /* already closed */ }
    this.port = undefined;
  }

  private async read(onData: (data: Uint8Array) => void, onClosed: () => void): Promise<void> {
    try {
      while (this.reader) {
        const { value, done } = await this.reader.read();
        if (done) break;
        if (value?.byteLength) onData(value);
      }
    } finally {
      if (!this.closing) onClosed();
    }
  }
}

class NativeBluetoothByteConnection implements ByteConnection {
  private listeners: PluginListenerHandle[] = [];
  private subscribed = false;
  private connected = false;
  private opening = false;
  private closing = false;
  private securedAccessStarted = false;
  private resolveOpeningDisconnect?: () => void;

  constructor(
    private readonly config: RNodeInterfaceConfig,
    private readonly log: (code: string, details?: Record<string, string | number | boolean>) => void,
    private readonly acceptPairingDisconnect = false,
  ) {}

  async open(onData: (data: Uint8Array) => void, onClosed: () => void): Promise<void> {
    const deviceId = this.config.connection.deviceId;
    if (!deviceId) throw new Error('RNODE_BLE_NOT_AUTHORIZED');
    await initializeNativeBluetooth();
    this.closing = false;
    this.opening = true;
    this.listeners.push(await BluetoothLowEnergy.addListener('deviceDisconnected', (event) => {
      if (event.deviceId !== deviceId) return;
      this.connected = false;
      if (!this.closing && this.opening) {
        this.resolveOpeningDisconnect?.();
        return;
      }
      if (!this.closing && !this.opening) onClosed();
    }));
    this.listeners.push(await BluetoothLowEnergy.addListener('characteristicChanged', (event) => {
      if (event.deviceId !== deviceId
        || normalizeUuid(event.service) !== RNODE_NUS_SERVICE
        || normalizeUuid(event.characteristic) !== RNODE_NUS_NOTIFY) return;
      if (event.value.length) onData(Uint8Array.from(event.value));
    }));

    try {
      await this.ensureDiscovered(deviceId);
      await this.ensureAndroidBond(deviceId);
      let lastError: unknown;
      for (let attempt = 1; attempt <= BLE_CONNECT_ATTEMPTS; attempt += 1) {
        try {
          this.securedAccessStarted = false;
          const disconnected = new Promise<false>((resolve) => {
            this.resolveOpeningDisconnect = () => resolve(false);
          });
          const ready = await Promise.race([
            this.openGatt(deviceId).then(() => true as const),
            disconnected,
          ]);
          if (!ready) {
            if (this.acceptPairingDisconnect && this.securedAccessStarted) {
              // RNode firmware deliberately drops the first connection after
              // accepting a new bond. For the selection-time authorization
              // probe that disconnect means the PIN exchange has completed;
              // do not reconnect and trigger another iOS passkey sheet.
              this.opening = false;
              await sleep(BLE_POST_PAIRING_GRACE_MS);
              return;
            }
            throw new Error('RNode disconnected while establishing the secured GATT session');
          }
          this.opening = false;
          this.log('RNODE_BLE_GATT_READY', { interfaceId: this.config.id, attempt, transport: Capacitor.getPlatform() });
          return;
        } catch (error) {
          lastError = error;
          const retry = attempt < BLE_CONNECT_ATTEMPTS && isRetryableBleError(error);
          this.log('RNODE_BLE_GATT_INTERRUPTED', {
            interfaceId: this.config.id,
            attempt,
            retry,
            message: errorMessage(error),
          });
          await this.disconnect(deviceId);
          if (!retry) break;
          await sleep(BLE_RETRY_DELAY_MS);
        } finally {
          this.resolveOpeningDisconnect = undefined;
        }
      }
      throw lastError instanceof Error ? lastError : new Error('RNODE_BLE_CONNECTION_FAILED');
    } finally {
      this.opening = false;
    }
  }

  async write(data: Uint8Array): Promise<void> {
    const deviceId = this.config.connection.deviceId;
    if (!deviceId || !this.connected) throw new Error('RNODE_BLE_NOT_OPEN');
    for (let offset = 0; offset < data.byteLength; offset += BLE_WRITE_CHUNK_SIZE) {
      await BluetoothLowEnergy.writeCharacteristic({
        deviceId,
        service: RNODE_NUS_SERVICE_NATIVE,
        characteristic: RNODE_NUS_WRITE_NATIVE,
        value: Array.from(data.slice(offset, offset + BLE_WRITE_CHUNK_SIZE)),
        type: 'withoutResponse',
      });
    }
  }

  async close(): Promise<void> {
    this.closing = true;
    this.opening = false;
    const deviceId = this.config.connection.deviceId;
    if (deviceId) await this.disconnect(deviceId);
    for (const listener of this.listeners) await listener.remove().catch(() => undefined);
    this.listeners = [];
  }

  private async ensureDiscovered(deviceId: string): Promise<void> {
    if (nativeBluetoothDeviceIsDiscovered(deviceId)) return;
    const listener = await BluetoothLowEnergy.addListener('deviceScanned', ({ device }) => {
      rememberNativeBluetoothDevice(device.deviceId);
    });
    try {
      await BluetoothLowEnergy.startScan({ services: [RNODE_NUS_SERVICE], timeout: 10_000, allowDuplicates: false });
      const deadline = Date.now() + 10_000;
      while (!nativeBluetoothDeviceIsDiscovered(deviceId) && Date.now() < deadline) await sleep(100);
      if (!nativeBluetoothDeviceIsDiscovered(deviceId)) throw new Error('RNODE_BLE_DEVICE_NOT_FOUND');
    } finally {
      await BluetoothLowEnergy.stopScan().catch(() => undefined);
      await listener.remove().catch(() => undefined);
    }
  }

  private async ensureAndroidBond(deviceId: string): Promise<void> {
    if (Capacitor.getPlatform() !== 'android') return;
    const { bonded } = await BluetoothLowEnergy.isBonded({ deviceId });
    if (bonded) return;

    // The Android plugin resolves createBond() when bonding starts, not when
    // the system PIN dialog has completed. Wait for BOND_BONDED before opening
    // GATT or the connection races the user's passkey entry.
    await BluetoothLowEnergy.createBond({ deviceId });
    const deadline = Date.now() + BLE_PAIRING_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if ((await BluetoothLowEnergy.isBonded({ deviceId })).bonded) {
        await sleep(BLE_POST_PAIRING_GRACE_MS);
        return;
      }
      await sleep(250);
    }
    throw new Error('RNODE_BLE_PAIRING_TIMEOUT');
  }

  private async validateNus(deviceId: string): Promise<void> {
    const { services } = await BluetoothLowEnergy.getServices({ deviceId });
    const service = services.find((entry) => normalizeUuid(entry.uuid) === RNODE_NUS_SERVICE);
    if (!service) throw new Error('get NUS service: requested service was not found');
    if (!service.characteristics.some((entry) => normalizeUuid(entry.uuid) === RNODE_NUS_WRITE)) {
      throw new Error('get RX characteristic: requested characteristic was not found');
    }
    if (!service.characteristics.some((entry) => normalizeUuid(entry.uuid) === RNODE_NUS_NOTIFY)) {
      throw new Error('get TX characteristic: requested characteristic was not found');
    }
  }

  private async openGatt(deviceId: string): Promise<void> {
    await bleStage('connect', () => BluetoothLowEnergy.connect({ deviceId }));
    this.connected = true;
    await sleep(BLE_POST_CONNECT_SETTLE_MS);
    await bleStage('discover NUS service', () => BluetoothLowEnergy.discoverServices({ deviceId }));
    await this.validateNus(deviceId);
    // Follow the same setup order as Web Bluetooth: enable the protected TX
    // notifications before sending any KISS data. Do not force a
    // write-with-response authorization probe here. RNode's NUS RX
    // characteristic is normally write-without-response; CoreBluetooth may
    // display the PIN sheet for such a forced write but never invoke the
    // with-response completion, which caused every timeout retry to prompt for
    // the PIN again. Once notifications are ready, RNodeHost sends the normal
    // KISS detect frame through write-without-response.
    this.securedAccessStarted = true;
    await bleStage('start TX notifications', () => BluetoothLowEnergy.startCharacteristicNotifications({
      deviceId,
      service: RNODE_NUS_SERVICE_NATIVE,
      characteristic: RNODE_NUS_NOTIFY_NATIVE,
    }), BLE_PAIRING_TIMEOUT_MS);
    this.subscribed = true;
  }

  private async disconnect(deviceId: string): Promise<void> {
    if (this.subscribed) {
      await BluetoothLowEnergy.stopCharacteristicNotifications({
        deviceId,
        service: RNODE_NUS_SERVICE_NATIVE,
        characteristic: RNODE_NUS_NOTIFY_NATIVE,
      }).catch(() => undefined);
    }
    this.subscribed = false;
    await BluetoothLowEnergy.disconnect({ deviceId }).catch(() => undefined);
    this.connected = false;
  }
}

class BluetoothByteConnection implements ByteConnection {
  private device?: BluetoothDevice;
  private server?: BluetoothRemoteGattServer;
  private writeCharacteristic?: BluetoothRemoteGattCharacteristic;
  private notifyCharacteristic?: BluetoothRemoteGattCharacteristic;
  private notificationListener?: EventListener;
  private disconnectListener?: EventListener;
  private closing = false;
  private opening = false;

  constructor(
    private readonly config: RNodeInterfaceConfig,
    private readonly log: (code: string, details?: Record<string, string | number | boolean>) => void,
  ) {}

  async open(onData: (data: Uint8Array) => void, onClosed: () => void): Promise<void> {
    if (!navigator.bluetooth) throw new Error('RNODE_BLE_DEVICE_ACCESS_UNAVAILABLE');
    if (this.device && this.disconnectListener) {
      this.device.removeEventListener('gattserverdisconnected', this.disconnectListener);
    }
    let source: 'connection' | 'selection' | 'authorization' = 'connection';
    if (!this.device) {
      const resolved = await resolveBluetoothDevice(this.config.connection.deviceId);
      this.device = resolved.device;
      if (resolved.source === 'missing') throw new Error('RNODE_BLE_NOT_AUTHORIZED');
      source = resolved.source;
    }
    if (!this.device?.gatt) throw new Error('RNODE_BLE_NOT_AUTHORIZED');
    this.log('RNODE_BLE_DEVICE_RESOLVED', {
      interfaceId: this.config.id,
      source,
      deviceName: this.device.name ?? 'RNode',
    });
    this.closing = false;
    this.opening = true;
    const device = this.device;
    const disconnectListener = () => {
      if (this.device !== device || this.disconnectListener !== disconnectListener) return;
      if (!this.closing && !this.opening) onClosed();
    };
    this.disconnectListener = disconnectListener;
    this.device.addEventListener('gattserverdisconnected', this.disconnectListener);
    try {
      await this.ensureAndroidBond();
      let lastError: unknown;
      for (let attempt = 1; attempt <= BLE_CONNECT_ATTEMPTS; attempt += 1) {
        try {
          await this.openGatt(onData);
          this.opening = false;
          this.log('RNODE_BLE_GATT_READY', { interfaceId: this.config.id, attempt });
          return;
        } catch (error) {
          lastError = error;
          const retry = attempt < BLE_CONNECT_ATTEMPTS && isRetryableBleError(error);
          this.log('RNODE_BLE_GATT_INTERRUPTED', {
            interfaceId: this.config.id,
            attempt,
            retry,
            message: errorMessage(error),
          });
          await this.closeGatt();
          if (!retry) break;
          await sleep(BLE_RETRY_DELAY_MS);
        }
      }
      throw lastError instanceof Error ? lastError : new Error('RNODE_BLE_CONNECTION_FAILED');
    } finally {
      this.opening = false;
    }
  }

  async write(data: Uint8Array): Promise<void> {
    if (!this.writeCharacteristic) throw new Error('RNODE_BLE_NOT_OPEN');
    for (let offset = 0; offset < data.byteLength; offset += BLE_WRITE_CHUNK_SIZE) {
      const chunk = data.slice(offset, offset + BLE_WRITE_CHUNK_SIZE);
      if (this.writeCharacteristic.writeValueWithoutResponse) await this.writeCharacteristic.writeValueWithoutResponse(chunk);
      else await this.writeCharacteristic.writeValue(chunk);
    }
  }

  async close(): Promise<void> {
    this.closing = true;
    this.opening = false;
    await this.closeGatt();
    if (this.device && this.disconnectListener) this.device.removeEventListener('gattserverdisconnected', this.disconnectListener);
    this.disconnectListener = undefined;
  }

  private async ensureAndroidBond(): Promise<void> {
    if (Capacitor.getPlatform() !== 'android' || !this.device) return;
    await BluetoothLowEnergy.requestPermissions();
    const { bonded } = await BluetoothLowEnergy.isBonded({ deviceId: this.device.id });
    if (!bonded) await BluetoothLowEnergy.createBond({ deviceId: this.device.id });
  }

  private async openGatt(onData: (data: Uint8Array) => void): Promise<void> {
    if (!this.device?.gatt) throw new Error('RNODE_BLE_NOT_AUTHORIZED');
    this.server = await bleStage('connect', () => this.device!.gatt!.connect());
    await sleep(BLE_POST_CONNECT_SETTLE_MS);
    const service = await bleStage('get NUS service', () => this.server!.getPrimaryService(RNODE_NUS_SERVICE));
    this.writeCharacteristic = await bleStage('get RX characteristic', () => service.getCharacteristic(RNODE_NUS_WRITE));
    this.notifyCharacteristic = await bleStage('get TX characteristic', () => service.getCharacteristic(RNODE_NUS_NOTIFY));
    this.notificationListener = (event) => {
      const value = (event.currentTarget as BluetoothRemoteGattCharacteristic).value;
      if (value?.byteLength) onData(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
    };
    await bleStage('start TX notifications', () => this.notifyCharacteristic!.startNotifications());
    this.notifyCharacteristic.addEventListener('characteristicvaluechanged', this.notificationListener);
  }

  private async closeGatt(): Promise<void> {
    if (this.notifyCharacteristic && this.notificationListener) {
      this.notifyCharacteristic.removeEventListener('characteristicvaluechanged', this.notificationListener);
    }
    // Disconnecting GATT stops notifications. Awaiting stopNotifications()
    // after Electron has already lost the peripheral can leave cleanup stuck
    // and prevents the host's reconnect timer from being armed.
    try { this.device?.gatt?.disconnect(); } catch { /* device gone */ }
    this.server = undefined;
    this.writeCharacteristic = undefined;
    this.notifyCharacteristic = undefined;
    this.notificationListener = undefined;
  }

}

export function isRetryableBleError(error: unknown): boolean {
  const message = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  return /gatt|disconnect|networkerror|operation failed|connection|encrypt|authenticat|security|pair|insufficient|timed out|temporary/i.test(message);
}

async function bleStage<T>(
  label: string,
  operation: () => Promise<T>,
  timeoutMs: number = BLE_STAGE_TIMEOUT_MS,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation(),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error(`${label} timed out`)), timeoutMs);
      }),
    ]);
  } catch (error) {
    throw new Error(`${label}: ${errorMessage(error)}`);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function normalizeUuid(value: string): string {
  return value.toLowerCase();
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export class NativeSocketByteConnection implements ByteConnection {
  private removeListener?: () => void;
  private onData?: (data: Uint8Array) => void;
  private onClosed?: () => void;
  private readonly bridge = window.retivumDesktopSockets ?? window.retivumMobileSockets;

  constructor(private readonly config: TcpInterfaceConfig) {}

  async open(onData: (data: Uint8Array) => void, onClosed: () => void): Promise<void> {
    if (!this.bridge) throw new Error('TCP_BRIDGE_UNAVAILABLE');
    this.onData = onData;
    this.onClosed = onClosed;
    this.removeListener = this.bridge.onEvent((event) => {
      if (event.id !== this.config.id) return;
      if (event.type === 'data' && event.data) this.onData?.(Uint8Array.from(event.data));
      if (event.type === 'closed' || event.type === 'error') this.onClosed?.();
    });
    await this.bridge.open({ id: this.config.id, ...this.config.connection });
  }

  async write(data: Uint8Array): Promise<void> {
    if (!this.bridge) throw new Error('TCP_BRIDGE_UNAVAILABLE');
    await this.bridge.write({ id: this.config.id, data: Array.from(data) });
  }

  async close(): Promise<void> {
    this.removeListener?.();
    this.removeListener = undefined;
    if (this.bridge) await this.bridge.close({ id: this.config.id });
  }
}

class CapacitorTcpByteConnection implements ByteConnection {
  private connection?: TCPConnection;
  private listeners: PluginListenerHandle[] = [];
  private closing = false;

  constructor(private readonly config: TcpInterfaceConfig) {}

  async open(onData: (data: Uint8Array) => void, onClosed: () => void): Promise<void> {
    this.closing = false;
    this.connection = TCPClient.createConnection({
      connectionId: this.config.id,
      host: this.config.connection.host,
      port: this.config.connection.port,
      timeout: TCP_CONNECT_TIMEOUT_MS,
      noDelay: true,
      keepAlive: true,
    });
    this.listeners.push(await this.connection.addListener('tcpData', (event) => {
      if (event.data.length) onData(Uint8Array.from(event.data));
    }));
    this.listeners.push(await this.connection.addListener('tcpDisconnect', () => {
      if (!this.closing) onClosed();
    }));
    const result = await this.connection.connect();
    if (result.error || !result.connected) throw new Error(result.errorMessage ?? 'TCP_CONNECTION_FAILED');
    const reading = await this.connection.startRead({ chunkSize: 16 * 1024 });
    if (reading.error || !reading.reading) throw new Error(reading.errorMessage ?? 'TCP_READ_FAILED');
  }

  async write(data: Uint8Array): Promise<void> {
    if (!this.connection) throw new Error('TCP_CONNECTION_NOT_OPEN');
    const result = await this.connection.write({ data });
    if (result.error || result.bytesSent !== data.byteLength) throw new Error(result.errorMessage ?? 'TCP_WRITE_FAILED');
  }

  async close(): Promise<void> {
    this.closing = true;
    for (const listener of this.listeners) await listener.remove().catch(() => undefined);
    this.listeners = [];
    await this.connection?.destroy().catch(() => undefined);
    this.connection = undefined;
  }
}
