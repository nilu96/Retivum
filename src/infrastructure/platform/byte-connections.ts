import type { RNodeInterfaceConfig, TcpInterfaceConfig } from '../../domain/settings';
import { Capacitor, type PluginListenerHandle } from '@capacitor/core';
import { BleClient } from '@capacitor-community/bluetooth-le';
import { TCPClient, type TCPConnection } from '@devioarts/capacitor-tcpclient';
import { resolveBluetoothDevice } from './bluetooth-devices';
import { initializeNativeBluetooth, prepareNativeBluetoothDevice } from './native-bluetooth';
import { resolveConfiguredSerialPort, resolveSerialPortSlot } from './serial-port-registry';

const RNODE_NUS_SERVICE = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
const RNODE_NUS_WRITE = '6e400002-b5a3-f393-e0a9-e50e24dcca9e';
const RNODE_NUS_NOTIFY = '6e400003-b5a3-f393-e0a9-e50e24dcca9e';
const BLE_CONNECT_ATTEMPTS = 5;
const BLE_RETRY_DELAY_MS = 3_500;
const BLE_POST_CONNECT_SETTLE_MS = 750;
const BLE_PAIRING_TIMEOUT_MS = 45_000;
const BLE_POST_PAIRING_GRACE_MS = 3_500;
const BLE_STAGE_TIMEOUT_MS = 15_000;
const BLE_SHUTDOWN_WRITE_TIMEOUT_MS = 1_000;
const BLE_SHUTDOWN_DELIVERY_GRACE_MS = 150;
const BLE_WRITE_CHUNK_SIZE = 20;
// iOS may hold the first local TCP connection while the user answers the
// Local Network permission sheet. The plugin's three-second default expires
// too quickly for that user-mediated flow.
const TCP_CONNECT_TIMEOUT_MS = 30_000;

export interface ByteConnection {
  open(onData: (data: Uint8Array) => void, onClosed: () => void): Promise<void>;
  write(data: Uint8Array): Promise<void>;
  close(finalData?: Uint8Array): Promise<void>;
  isConnected?(): Promise<boolean>;
}

export function createRNodeByteConnection(
  config: RNodeInterfaceConfig,
  log: (code: string, details?: Record<string, string | number | boolean>) => void = () => undefined,
): ByteConnection {
  if (config.connection.type !== 'ble') return new SerialByteConnection(config);
  if (window.retivumDesktopBluetooth) return new DesktopBluetoothByteConnection(config);
  return Capacitor.isNativePlatform()
    ? new NativeBluetoothByteConnection(config, log)
    : new BluetoothByteConnection(config, log);
}

export function createSerialPortByteConnection(port: SerialPort, slotId: string): ByteConnection {
  return new SerialByteConnection(undefined, port, slotId);
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
    schemaVersion: 5,
    createdAt: new Date(0).toISOString(),
    type: 'rnode',
    name: 'RNode',
    enabled: false,
    mode: 'full',
    reannounceOnReconnect: false,
    ifac: { networkName: '', passphrase: '', credentialRevision: 'authorization' },
    connection: { type: 'ble', deviceId },
    radio: {
      frequency: 869_462_500,
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
  private preferredPort?: SerialPort;
  private reader?: ReadableStreamDefaultReader<Uint8Array>;
  private writer?: WritableStreamDefaultWriter<Uint8Array>;
  private closing = false;
  private refreshPortBeforeOpen = false;

  constructor(
    private readonly config?: RNodeInterfaceConfig,
    private readonly selectedPort?: SerialPort,
    private readonly slotId?: string,
  ) {
    this.preferredPort = selectedPort;
  }

  async open(onData: (data: Uint8Array) => void, onClosed: () => void): Promise<void> {
    const preferredPort = this.preferredPort;
    const usePreferredPort = preferredPort !== undefined
      && !this.refreshPortBeforeOpen
      && preferredPort.connected !== false;
    if (usePreferredPort) this.port = preferredPort;
    else if (this.slotId) this.port = await resolveSerialPortSlot(this.slotId, preferredPort);
    else if (this.config) this.port = await resolveConfiguredSerialPort(this.config);
    else throw new Error('RNODE_SERIAL_NOT_AUTHORIZED');
    this.preferredPort = this.port;
    try {
      await this.port.open({ baudRate: 115_200, dataBits: 8, stopBits: 1, parity: 'none', flowControl: 'none' });
      this.refreshPortBeforeOpen = false;
    } catch (error) {
      this.refreshPortBeforeOpen = true;
      throw error;
    }
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

  async close(finalData?: Uint8Array): Promise<void> {
    this.closing = true;
    this.refreshPortBeforeOpen = true;
    if (finalData?.byteLength && this.writer) {
      await bleStage(
        'send RNode shutdown',
        () => this.writer!.write(finalData),
        BLE_SHUTDOWN_WRITE_TIMEOUT_MS,
      ).catch(() => undefined);
    }
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

class DesktopBluetoothByteConnection implements ByteConnection {
  private removeListener?: () => void;
  private closing = false;

  constructor(private readonly config: RNodeInterfaceConfig) {}

  async open(onData: (data: Uint8Array) => void, onClosed: () => void): Promise<void> {
    const bridge = window.retivumDesktopBluetooth;
    if (!bridge) throw new Error('RNODE_BLE_UNAVAILABLE');
    const deviceId = this.config.connection.deviceId;
    if (!deviceId) throw new Error('RNODE_BLE_NOT_AUTHORIZED');
    this.closing = false;
    this.removeListener?.();
    this.removeListener = bridge.onEvent((event) => {
      if (event.id !== this.config.id) return;
      if (event.type === 'data' && event.data?.length) onData(Uint8Array.from(event.data));
      if (!this.closing && (event.type === 'closed' || event.type === 'error')) onClosed();
    });
    try {
      await bridge.open({ id: this.config.id, deviceId });
    } catch (error) {
      this.removeListener?.();
      this.removeListener = undefined;
      throw desktopBridgeError(error);
    }
  }

  async write(data: Uint8Array): Promise<void> {
    const bridge = window.retivumDesktopBluetooth;
    if (!bridge) throw new Error('RNODE_BLE_UNAVAILABLE');
    try {
      await bridge.write({ id: this.config.id, data: Array.from(data) });
    } catch (error) {
      throw desktopBridgeError(error);
    }
  }

  async close(finalData?: Uint8Array): Promise<void> {
    this.closing = true;
    const bridge = window.retivumDesktopBluetooth;
    if (bridge && finalData?.byteLength) {
      const delivered = await bleStage(
        'send RNode shutdown',
        () => bridge.write({ id: this.config.id, data: Array.from(finalData) }),
        BLE_SHUTDOWN_WRITE_TIMEOUT_MS,
      ).then(() => true, () => false);
      if (delivered) await sleep(BLE_SHUTDOWN_DELIVERY_GRACE_MS);
    }
    await bridge?.close({ id: this.config.id }).catch(() => undefined);
    this.removeListener?.();
    this.removeListener = undefined;
  }
}

class NativeBluetoothByteConnection implements ByteConnection {
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
    const onDisconnect = () => {
      this.connected = false;
      if (!this.closing && this.opening) {
        this.resolveOpeningDisconnect?.();
        return;
      }
      if (!this.closing && !this.opening) onClosed();
    };

    try {
      await prepareNativeBluetoothDevice(deviceId);
      await this.ensureAndroidBond(deviceId);
      if (this.closing) throw new Error('RNODE_BLE_CONNECTION_CANCELLED');
      let lastError: unknown;
      for (let attempt = 1; attempt <= BLE_CONNECT_ATTEMPTS; attempt += 1) {
        if (this.closing) throw new Error('RNODE_BLE_CONNECTION_CANCELLED');
        try {
          this.securedAccessStarted = false;
          const disconnected = new Promise<false>((resolve) => {
            this.resolveOpeningDisconnect = () => resolve(false);
          });
          const ready = await Promise.race([
            this.openGatt(deviceId, onData, onDisconnect).then(() => true as const),
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
          const pairingFailed = this.acceptPairingDisconnect && this.securedAccessStarted;
          lastError = pairingFailed ? new Error('RNODE_BLE_PAIRING_FAILED') : error;
          const retry = !pairingFailed
            && !this.closing
            && attempt < BLE_CONNECT_ATTEMPTS
            && isRetryableBleError(error);
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
    await this.writeChunks(data);
  }

  async isConnected(): Promise<boolean> {
    const deviceId = this.config.connection.deviceId;
    if (!deviceId || !this.connected) return false;
    const devices = await bleStage(
      'check connection',
      () => BleClient.getConnectedDevices([RNODE_NUS_SERVICE]),
    );
    return devices.some((device) => device.deviceId === deviceId);
  }

  private async writeChunks(data: Uint8Array, timeoutMs?: number): Promise<void> {
    const deviceId = this.config.connection.deviceId;
    if (!deviceId || !this.connected) throw new Error('RNODE_BLE_NOT_OPEN');
    for (let offset = 0; offset < data.byteLength; offset += BLE_WRITE_CHUNK_SIZE) {
      const chunk = data.slice(offset, offset + BLE_WRITE_CHUNK_SIZE);
      await BleClient.writeWithoutResponse(
        deviceId,
        RNODE_NUS_SERVICE,
        RNODE_NUS_WRITE,
        new DataView(chunk.buffer, chunk.byteOffset, chunk.byteLength),
        timeoutMs === undefined ? undefined : { timeout: timeoutMs },
      );
    }
  }

  async close(finalData?: Uint8Array): Promise<void> {
    this.closing = true;
    this.resolveOpeningDisconnect?.();
    this.opening = false;
    const deviceId = this.config.connection.deviceId;
    if (!deviceId) return;
    if (finalData?.byteLength && this.connected) {
      const delivered = await this.writeChunks(finalData, BLE_SHUTDOWN_WRITE_TIMEOUT_MS)
        .then(() => true, () => false);
      if (delivered) await sleep(BLE_SHUTDOWN_DELIVERY_GRACE_MS);
    }
    await this.disconnect(deviceId);
  }

  private async ensureAndroidBond(deviceId: string): Promise<void> {
    if (Capacitor.getPlatform() !== 'android') return;
    if (await BleClient.isBonded(deviceId)) return;
    try {
      await BleClient.createBond(deviceId, { timeout: BLE_PAIRING_TIMEOUT_MS });
    } catch {
      throw new Error('RNODE_BLE_PAIRING_FAILED');
    }
    await sleep(BLE_POST_PAIRING_GRACE_MS);
  }

  private async validateNus(deviceId: string): Promise<void> {
    const services = await BleClient.getServices(deviceId);
    const service = services.find((entry) => normalizeUuid(entry.uuid) === RNODE_NUS_SERVICE);
    if (!service) throw new Error('get NUS service: requested service was not found');
    if (!service.characteristics.some((entry) => normalizeUuid(entry.uuid) === RNODE_NUS_WRITE)) {
      throw new Error('get RX characteristic: requested characteristic was not found');
    }
    if (!service.characteristics.some((entry) => normalizeUuid(entry.uuid) === RNODE_NUS_NOTIFY)) {
      throw new Error('get TX characteristic: requested characteristic was not found');
    }
  }

  private async openGatt(
    deviceId: string,
    onData: (data: Uint8Array) => void,
    onDisconnect: () => void,
  ): Promise<void> {
    await bleStage('connect', () => BleClient.connect(deviceId, onDisconnect, { timeout: BLE_STAGE_TIMEOUT_MS }));
    this.connected = true;
    await sleep(BLE_POST_CONNECT_SETTLE_MS);
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
    await bleStage('start TX notifications', () => BleClient.startNotifications(
      deviceId,
      RNODE_NUS_SERVICE,
      RNODE_NUS_NOTIFY,
      (value) => {
        if (value.byteLength) onData(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
      },
      { timeout: BLE_PAIRING_TIMEOUT_MS },
    ), BLE_PAIRING_TIMEOUT_MS);
    this.subscribed = true;
  }

  private async disconnect(deviceId: string): Promise<void> {
    const wasSubscribed = this.subscribed;
    this.subscribed = false;
    // Explicit shutdown must start with the physical disconnect. Both native
    // implementations stop notifications as part of disconnecting, while a
    // separate stopNotifications call can wait on a stale GATT operation and
    // prevent disable/delete from ever reaching the disconnect request.
    await BleClient.disconnect(deviceId).catch(() => undefined);
    this.connected = false;
    // BleClient removes its JavaScript notification listener before forwarding
    // this call to native. The peripheral is already disconnected, so ignore
    // the expected native "device not found/not connected" result.
    if (wasSubscribed) {
      await BleClient.stopNotifications(deviceId, RNODE_NUS_SERVICE, RNODE_NUS_NOTIFY).catch(() => undefined);
    }
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
      let lastError: unknown;
      for (let attempt = 1; attempt <= BLE_CONNECT_ATTEMPTS; attempt += 1) {
        if (this.closing) throw new Error('RNODE_BLE_CONNECTION_CANCELLED');
        try {
          await this.openGatt(onData);
          this.opening = false;
          this.log('RNODE_BLE_GATT_READY', { interfaceId: this.config.id, attempt });
          return;
        } catch (error) {
          lastError = error;
          const retry = !this.closing
            && attempt < BLE_CONNECT_ATTEMPTS
            && isRetryableBleError(error);
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

  async close(finalData?: Uint8Array): Promise<void> {
    this.closing = true;
    this.opening = false;
    if (finalData?.byteLength && this.writeCharacteristic) {
      const delivered = await bleStage(
        'send RNode shutdown',
        () => this.write(finalData),
        BLE_SHUTDOWN_WRITE_TIMEOUT_MS,
      ).then(() => true, () => false);
      if (delivered) await sleep(BLE_SHUTDOWN_DELIVERY_GRACE_MS);
    }
    await this.closeGatt();
    if (this.device && this.disconnectListener) this.device.removeEventListener('gattserverdisconnected', this.disconnectListener);
    this.disconnectListener = undefined;
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

function desktopBridgeError(error: unknown): Error {
  const message = errorMessage(error);
  const code = message.match(/RNODE_[A-Z0-9_]+/)?.[0];
  return new Error(code ?? 'RNODE_BLE_CONNECTION_FAILED');
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
  private state: 'closed' | 'opening' | 'open' = 'closed';
  private readonly bridge = window.retivumDesktopSockets ?? window.retivumMobileSockets;

  constructor(private readonly config: TcpInterfaceConfig) {}

  async open(onData: (data: Uint8Array) => void, onClosed: () => void): Promise<void> {
    if (!this.bridge) throw new Error('TCP_BRIDGE_UNAVAILABLE');
    this.removeListener?.();
    this.onData = onData;
    this.onClosed = onClosed;
    this.state = 'opening';
    this.removeListener = this.bridge.onEvent((event) => {
      if (event.id !== this.config.id) return;
      if (event.type === 'data' && event.data && this.state !== 'closed') {
        this.onData?.(Uint8Array.from(event.data));
      }
      if (event.type === 'closed' || event.type === 'error') this.markClosed();
    });
    await this.bridge.open({ id: this.config.id, ...this.config.connection });
    if (this.state !== 'opening') throw new Error('TCP_SOCKET_NOT_OPEN');
    this.state = 'open';
  }

  async write(data: Uint8Array): Promise<void> {
    if (!this.bridge) throw new Error('TCP_BRIDGE_UNAVAILABLE');
    if (this.state !== 'open') return;
    try {
      await this.bridge.write({ id: this.config.id, data: Array.from(data) });
    } catch (error) {
      const message = errorMessage(error);
      if (message.includes('TCP_SOCKET_NOT_OPEN') || message.includes('TCP_SOCKET_WRITE_FAILED')) {
        this.markClosed();
        return;
      }
      throw error;
    }
  }

  async close(): Promise<void> {
    this.state = 'closed';
    this.removeListener?.();
    this.removeListener = undefined;
    if (this.bridge) await this.bridge.close({ id: this.config.id });
  }

  private markClosed(): void {
    if (this.state === 'closed') return;
    this.state = 'closed';
    this.onClosed?.();
  }
}

class CapacitorTcpByteConnection implements ByteConnection {
  private connection?: TCPConnection;
  private listeners: PluginListenerHandle[] = [];
  private closing = false;
  private generation = 0;
  private closePromise?: Promise<void>;

  constructor(private readonly config: TcpInterfaceConfig) {}

  async open(onData: (data: Uint8Array) => void, onClosed: () => void): Promise<void> {
    await this.closePromise?.catch(() => undefined);
    const generation = ++this.generation;
    this.closing = false;
    const connection = TCPClient.createConnection({
      host: this.config.connection.host,
      port: this.config.connection.port,
      timeout: TCP_CONNECT_TIMEOUT_MS,
      noDelay: true,
      keepAlive: true,
    });
    this.connection = connection;
    const isCurrent = (): boolean => (
      !this.closing && this.generation === generation && this.connection === connection
    );
    try {
      const dataListener = await connection.addListener('tcpData', (event) => {
        if (isCurrent() && event.data.length) onData(Uint8Array.from(event.data));
      });
      if (!isCurrent()) {
        await dataListener.remove().catch(() => undefined);
        throw new Error('TCP_CONNECTION_CLOSED');
      }
      this.listeners.push(dataListener);

      const disconnectListener = await connection.addListener('tcpDisconnect', () => {
        if (isCurrent()) onClosed();
      });
      if (!isCurrent()) {
        await disconnectListener.remove().catch(() => undefined);
        throw new Error('TCP_CONNECTION_CLOSED');
      }
      this.listeners.push(disconnectListener);

      const result = await connection.connect();
      if (!isCurrent()) throw new Error('TCP_CONNECTION_CLOSED');
      if (result.error || !result.connected) throw new Error(result.errorMessage ?? 'TCP_CONNECTION_FAILED');
      const reading = await connection.startRead({ chunkSize: 16 * 1024 });
      if (!isCurrent()) throw new Error('TCP_CONNECTION_CLOSED');
      if (reading.error || !reading.reading) throw new Error(reading.errorMessage ?? 'TCP_READ_FAILED');
    } catch (error) {
      await this.close();
      throw error;
    }
  }

  async write(data: Uint8Array): Promise<void> {
    const connection = this.connection;
    if (!connection || this.closing) throw new Error('TCP_CONNECTION_NOT_OPEN');
    const result = await connection.write({ data });
    if (result.error || result.bytesSent !== data.byteLength) throw new Error(result.errorMessage ?? 'TCP_WRITE_FAILED');
  }

  async isConnected(): Promise<boolean> {
    const connection = this.connection;
    if (!connection || this.closing) return false;
    // The current iOS plugin performs this health check by synchronously
    // waiting on its socket queue from UIKit's main queue. An in-flight connect
    // can therefore freeze the app for the full connection timeout. Returning
    // false makes the shared resume path rebuild the socket without invoking
    // that unsafe native method. Android's implementation runs off the UI
    // thread and can retain the cheaper in-place health check.
    if (Capacitor.getPlatform() === 'ios') return false;
    const result = await connection.isConnected();
    if (result.error) throw new Error(result.errorMessage ?? 'TCP_CONNECTION_CHECK_FAILED');
    return result.connected;
  }

  async close(): Promise<void> {
    this.generation += 1;
    this.closing = true;
    if (this.closePromise) return this.closePromise;
    const connection = this.connection;
    const listeners = this.listeners;
    this.connection = undefined;
    this.listeners = [];
    const operation = (async () => {
      for (const listener of listeners) await listener.remove().catch(() => undefined);
      await connection?.destroy().catch(() => undefined);
    })();
    this.closePromise = operation;
    try {
      await operation;
    } finally {
      if (this.closePromise === operation) this.closePromise = undefined;
    }
  }
}
