import {
  createRNodeInterfaceDraft,
  type RNodeConnectionType,
  type RNodeInterfaceConfig,
} from '../../domain/settings';
import {
  decodeProvisioningEnvelope,
  encodeProvisioningRequest,
  type ProvisioningValue,
} from '../../domain/provisioning';
import { ProvisioningClient } from '../reticulum/provisioning-client';
import type { RNodeInterfaceTelemetry } from '../reticulum/protocol';
import {
  createRNodeByteConnection,
  createSerialPortByteConnection,
  type ByteConnection,
} from './byte-connections';
import { rememberBluetoothDevice } from './bluetooth-devices';
import { takeDesktopDeviceSelection } from './desktop-device-selection';
import { authorizeRNodeDevice, selectRNodeDevice } from './interface-capabilities';
import { KissDeframer, frame, parseRNodeTelemetry } from './rnode-host';

const CMD_DETECT = 0x08;
const CMD_LEAVE = 0x0a;
const CMD_FREQUENCY = 0x01;
const CMD_BANDWIDTH = 0x02;
const CMD_TXPOWER = 0x03;
const CMD_SF = 0x04;
const CMD_CR = 0x05;
const CMD_RADIO_STATE = 0x06;
const CMD_LOG = 0x80;
const CMD_PROVISION_REQUEST = 0x86;
const CMD_PROVISION_RESPONSE = 0x87;
const CMD_PLATFORM = 0x48;
const CMD_MCU = 0x49;
const CMD_BOARD = 0x47;
const CMD_FIRMWARE_VERSION = 0x50;
const CMD_ROM_READ = 0x51;
const CMD_ROM_WRITE = 0x52;
const CMD_CONF_SAVE = 0x53;
const CMD_CONF_DELETE = 0x54;
const CMD_RESET = 0x55;
const CMD_UNLOCK_ROM = 0x59;
const CMD_BT_CTRL = 0x46;
const CMD_BT_PIN = 0x62;
const CMD_DISPLAY_INTENSITY = 0x45;
const CMD_DISPLAY_ADDRESS = 0x63;
const CMD_DISPLAY_BLANKING = 0x64;
const CMD_NEOPIXEL_INTENSITY = 0x65;
const CMD_DISPLAY_ROTATION = 0x67;
const CMD_DISABLE_INTERFERENCE_AVOIDANCE = 0x69;
const CMD_WIFI_MODE = 0x6a;
const CMD_WIFI_SSID = 0x6b;
const CMD_WIFI_PSK = 0x6c;
const CMD_WIFI_CHANNEL = 0x6e;
const CMD_BT_UNPAIR = 0x70;
const CMD_WIFI_IP = 0x84;
const CMD_WIFI_NETMASK = 0x85;
const DETECT_REQUEST = 0x73;
const DETECT_RESPONSE = 0x46;
const RESET_MARKER = 0xf8;
const EEPROM_CONFIG_OK_ADDRESS = 0xa7;
const EEPROM_CONFIG_OK = 0x73;
const EEPROM_INFO_LOCK_ADDRESS = 0x9b;
const EEPROM_INFO_LOCK = 0x73;
const EEPROM_RESERVED_BYTES = 200;
const MAX_MAINTENANCE_FRAME_BYTES = 1_100_000;
const SERIAL_RECONNECT_INITIAL_DELAY_MS = 1_000;
const SERIAL_RECONNECT_MAXIMUM_DELAY_MS = 5_000;
const SERIAL_RECONNECT_MULTIPLIER = 1.6;

export interface AuthorizedSerialRNode {
  id: string;
  transport: 'serial';
  label?: string;
  deviceName?: string;
  detail: string;
  port: SerialPort;
  configuredInterface?: RNodeInterfaceConfig;
}

export interface AuthorizedBleRNode {
  id: string;
  transport: 'ble';
  label: string;
  detail: string;
  connectionConfig: RNodeInterfaceConfig;
  configuredInterface?: RNodeInterfaceConfig;
  connected: boolean;
}

export type AuthorizedRNode = AuthorizedSerialRNode | AuthorizedBleRNode;

export interface LocalRNodeInfo {
  firmwareVersion?: string;
  platform?: number;
  mcu?: number;
  board?: number;
  eepromBytes?: number;
}

export type LocalRNodeConnectionEvent = {
  type: 'reconnecting';
  attempt: number;
  delayMs: number;
  error?: string;
} | {
  type: 'reconnected';
  info: LocalRNodeInfo;
};

export interface RNodeRadioConfig {
  bootMode: 'host' | 'tnc';
  frequency: number;
  bandwidth: number;
  spreadingFactor: number;
  codingRate: number;
  txPower: number;
  interferenceAvoidance: boolean;
}

export interface RNodeDisplayConfig {
  intensity: number;
  blankingTimeout: number;
  rotation: number;
  address: number;
  neopixelIntensity: number;
}

export interface RNodeWifiConfig {
  mode: number;
  channel: number;
  ssid: string;
  psk: string;
  ip: string;
  netmask: string;
}

export type LocalRNodeLogHandler = (message: string) => void;
export type LocalRNodeBluetoothPinHandler = (pin: string) => void;
export type LocalRNodeTelemetryHandler = (telemetry: RNodeInterfaceTelemetry) => void;

function decodeBe32(payload: Uint8Array): number {
  if (payload.byteLength !== 4) throw new Error('RNODE_CONFIG_INVALID_RESPONSE');
  return ((payload[0] * 0x1000000) + (payload[1] << 16) + (payload[2] << 8) + payload[3]) >>> 0;
}

function encodeBe32(value: number): Uint8Array {
  return Uint8Array.of(value >>> 24, value >>> 16, value >>> 8, value);
}

function encodeString(value: string): Uint8Array {
  const bytes = new TextEncoder().encode(value);
  if (bytes.byteLength > 32) throw new Error('RNODE_CONFIG_STRING_TOO_LONG');
  return Uint8Array.from([...bytes, 0]);
}

function encodeIpv4(value: string): Uint8Array {
  const parts = value.split('.');
  if (parts.length !== 4) throw new Error('RNODE_CONFIG_INVALID_IPV4');
  const octets = parts.map((part) => Number(part));
  if (octets.some((octet, index) => !/^\d{1,3}$/.test(parts[index]) || !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    throw new Error('RNODE_CONFIG_INVALID_IPV4');
  }
  return Uint8Array.from(octets);
}

function assertIntegerRange(value: number, min: number, max: number): void {
  if (!Number.isInteger(value) || value < min || value > max) throw new Error('RNODE_CONFIG_VALUE_OUT_OF_RANGE');
}

const serialPortIds = new WeakMap<SerialPort, string>();
const serialPortNames = new WeakMap<SerialPort, string>();
const serialUsbNames = new Map<string, string>();
let serialPortSequence = 1;

function portId(port: SerialPort): string {
  const existing = serialPortIds.get(port);
  if (existing) return existing;
  const id = `serial-${serialPortSequence++}`;
  serialPortIds.set(port, id);
  return id;
}

function hexId(value: number | undefined): string {
  return value === undefined ? '----' : value.toString(16).padStart(4, '0');
}

function serialUsbKey(info: SerialPortInfo): string | undefined {
  return info.usbVendorId !== undefined && info.usbProductId !== undefined
    ? `${info.usbVendorId}:${info.usbProductId}`
    : undefined;
}

function rememberSerialPortName(port: SerialPort, value: string | undefined): void {
  const name = value?.trim();
  if (!name) return;
  serialPortNames.set(port, name);
  const key = serialUsbKey(port.getInfo());
  if (key) serialUsbNames.set(key, name);
}

function knownSerialPortName(port: SerialPort): string | undefined {
  const key = serialUsbKey(port.getInfo());
  return serialPortNames.get(port) ?? (key ? serialUsbNames.get(key) : undefined);
}

function electronUsbId(value: string | undefined): number | undefined {
  if (!value || !/^[0-9a-f]+$/i.test(value)) return undefined;
  return Number.parseInt(value, 16);
}

async function refreshDesktopSerialPortNames(ports: readonly SerialPort[]): Promise<void> {
  const bridge = window.retivumDesktopDevices;
  if (!bridge) return;
  let devices: DesktopSerialDeviceMetadata[];
  try {
    devices = await bridge.serialDevices();
  } catch {
    return;
  }
  for (const port of ports) {
    const info = port.getInfo();
    const match = devices.find((device) => electronUsbId(device.vendorId) === info.usbVendorId
      && electronUsbId(device.productId) === info.usbProductId);
    rememberSerialPortName(port, match?.name);
  }
}

function matchingInterface(
  port: SerialPort,
  interfaces: readonly RNodeInterfaceConfig[],
): RNodeInterfaceConfig | undefined {
  const info = port.getInfo();
  return interfaces.find((config) => config.connection.type === 'serial'
    && (config.connection.usbVendorId === undefined || config.connection.usbVendorId === info.usbVendorId)
    && (config.connection.usbProductId === undefined || config.connection.usbProductId === info.usbProductId));
}

function matchingBleInterface(
  deviceId: string,
  interfaces: readonly RNodeInterfaceConfig[],
): RNodeInterfaceConfig | undefined {
  return interfaces.find((config) => config.connection.type === 'ble' && config.connection.deviceId === deviceId);
}

function bleMaintenanceDevice(
  deviceId: string,
  deviceName: string | undefined,
  configuredInterface?: RNodeInterfaceConfig,
  connected = false,
): AuthorizedBleRNode {
  const connectionConfig = configuredInterface
    ? { ...configuredInterface, connection: { ...configuredInterface.connection, deviceId, deviceName } }
    : createRNodeInterfaceDraft('ble', `maintenance-${crypto.randomUUID()}`);
  if (!configuredInterface) {
    connectionConfig.name = deviceName?.trim() || 'RNode';
    connectionConfig.enabled = false;
    connectionConfig.connection = { type: 'ble', deviceId, deviceName };
  }
  return {
    id: `ble-${deviceId}`,
    transport: 'ble',
    label: configuredInterface?.name.trim() || deviceName?.trim() || 'RNode',
    detail: 'BLE',
    connectionConfig,
    configuredInterface,
    connected,
  };
}

export async function listAuthorizedSerialRNodes(
  interfaces: readonly RNodeInterfaceConfig[],
): Promise<AuthorizedSerialRNode[]> {
  if (!navigator.serial) return [];
  const ports = await navigator.serial.getPorts();
  await refreshDesktopSerialPortNames(ports);
  return ports.filter((port) => port.connected !== false).map((port) => {
    const info = port.getInfo();
    const configuredInterface = matchingInterface(port, interfaces);
    const deviceName = configuredInterface?.connection.deviceName?.trim() || knownSerialPortName(port);
    return {
      id: portId(port),
      transport: 'serial' as const,
      port,
      configuredInterface,
      label: configuredInterface?.name.trim() || deviceName || undefined,
      ...(deviceName ? { deviceName } : {}),
      detail: `USB ${hexId(info.usbVendorId)}:${hexId(info.usbProductId)}`,
    };
  });
}

export async function listAuthorizedBleRNodes(
  interfaces: readonly RNodeInterfaceConfig[],
): Promise<AuthorizedBleRNode[]> {
  const devices = new Map<string, AuthorizedBleRNode>();
  for (const configuredInterface of interfaces) {
    if (configuredInterface.connection.type !== 'ble' || !configuredInterface.connection.deviceId) continue;
    const { deviceId, deviceName } = configuredInterface.connection;
    devices.set(deviceId, bleMaintenanceDevice(deviceId, deviceName, configuredInterface));
  }
  // Electron owns BLE through the native Noble bridge. Calling Chromium's
  // getDevices() from the one-second maintenance refresh would make a second
  // CoreBluetooth client repeatedly resolve the same saved peripheral and can
  // invalidate an otherwise healthy native session. Browser-authorized device
  // handles are relevant only when no desktop bridge is present.
  if (window.retivumDesktopBluetooth) {
    let connectedDeviceIds: string[] = [];
    try {
      connectedDeviceIds = await window.retivumDesktopBluetooth.connectedDevices();
    } catch {
      // Keep runtime interface status as the fallback when the native bridge is
      // temporarily unavailable during application startup or shutdown.
    }
    for (const deviceId of connectedDeviceIds) {
      const existing = devices.get(deviceId);
      if (existing) devices.set(deviceId, { ...existing, connected: true });
    }
  } else {
    const authorized = await navigator.bluetooth?.getDevices?.() ?? [];
    for (const device of authorized) {
      rememberBluetoothDevice(device);
      const configuredInterface = matchingBleInterface(device.id, interfaces);
      devices.set(device.id, bleMaintenanceDevice(
        device.id,
        device.name,
        configuredInterface,
        device.gatt?.connected === true,
      ));
    }
  }
  return Array.from(devices.values());
}

export async function listAuthorizedRNodes(
  interfaces: readonly RNodeInterfaceConfig[],
): Promise<AuthorizedRNode[]> {
  const [serial, ble] = await Promise.all([
    listAuthorizedSerialRNodes(interfaces),
    listAuthorizedBleRNodes(interfaces),
  ]);
  return [...serial, ...ble];
}

export async function requestSerialRNode(
  interfaces: readonly RNodeInterfaceConfig[],
): Promise<AuthorizedSerialRNode> {
  if (!navigator.serial) throw new Error('RNODE_SERIAL_UNAVAILABLE');
  const port = await navigator.serial.requestPort();
  const selectedDevice = takeDesktopDeviceSelection('serial');
  rememberSerialPortName(port, selectedDevice?.name);
  const info = port.getInfo();
  const configuredInterface = matchingInterface(port, interfaces);
  const deviceName = configuredInterface?.connection.deviceName?.trim() || knownSerialPortName(port);
  return {
    id: portId(port),
    transport: 'serial',
    port,
    configuredInterface,
    label: configuredInterface?.name.trim() || deviceName || undefined,
    ...(deviceName ? { deviceName } : {}),
    detail: `USB ${hexId(info.usbVendorId)}:${hexId(info.usbProductId)}`,
  };
}

export async function requestRNode(
  transport: RNodeConnectionType,
  interfaces: readonly RNodeInterfaceConfig[],
): Promise<AuthorizedRNode> {
  if (transport === 'serial') return requestSerialRNode(interfaces);
  const selected = await selectRNodeDevice('ble');
  if (!selected.deviceId) throw new Error('RNODE_BLE_NOT_AUTHORIZED');
  const persistentDeviceId = await authorizeRNodeDevice('ble', selected.deviceId);
  const deviceId = persistentDeviceId ?? selected.deviceId;
  return bleMaintenanceDevice(
    deviceId,
    selected.deviceName,
    matchingBleInterface(deviceId, interfaces),
  );
}

interface FrameWaiter {
  resolve(payload: Uint8Array): void;
  reject(error: Error): void;
  timeout: ReturnType<typeof setTimeout>;
}

export class RNodeMaintenanceSession {
  private deframer = new KissDeframer(MAX_MAINTENANCE_FRAME_BYTES);
  private readonly waiters = new Map<number, FrameWaiter[]>();
  private connection?: ByteConnection;
  private writeQueue: Promise<void> = Promise.resolve();
  private closing = false;
  private reconnectEnabled = false;
  private reconnecting = false;
  private reconnectAttempt = 0;
  private reconnectTimer?: ReturnType<typeof setTimeout>;

  constructor(
    readonly device: AuthorizedRNode,
    private readonly onLog: LocalRNodeLogHandler = () => undefined,
    private readonly onClosed: () => void = () => undefined,
    private readonly onBluetoothPin: LocalRNodeBluetoothPinHandler = () => undefined,
    private readonly onTelemetry: LocalRNodeTelemetryHandler = () => undefined,
    private readonly onConnectionEvent: (event: LocalRNodeConnectionEvent) => void = () => undefined,
    connection?: ByteConnection,
  ) {
    this.connection = connection;
  }

  async open(): Promise<LocalRNodeInfo> {
    this.closing = false;
    this.reconnectEnabled = false;
    this.clearReconnectTimer();
    try {
      const info = await this.openConnection();
      this.reconnectEnabled = this.device.transport === 'serial';
      this.reconnectAttempt = 0;
      return info;
    } catch (error) {
      await this.connection?.close().catch(() => undefined);
      throw error;
    }
  }

  private async openConnection(): Promise<LocalRNodeInfo> {
    this.deframer = new KissDeframer(MAX_MAINTENANCE_FRAME_BYTES);
    this.writeQueue = Promise.resolve();
    this.connection ??= this.device.transport === 'serial'
      ? createSerialPortByteConnection(this.device.port)
      : createRNodeByteConnection(this.device.connectionConfig);
    await this.connection.open(
      (data) => this.receive(data),
      () => this.connectionClosed(),
    );
    const detected = await this.request(CMD_DETECT, Uint8Array.of(DETECT_REQUEST), 2_000);
    if (detected[0] !== DETECT_RESPONSE) throw new Error('RNODE_NOT_DETECTED');
    const [firmware, platform, mcu, board, rom] = await Promise.all([
      this.optionalRequest(CMD_FIRMWARE_VERSION, Uint8Array.of(0)),
      this.optionalRequest(CMD_PLATFORM, Uint8Array.of(0)),
      this.optionalRequest(CMD_MCU, Uint8Array.of(0)),
      this.optionalRequest(CMD_BOARD, Uint8Array.of(0)),
      this.optionalRequest(CMD_ROM_READ, Uint8Array.of(0), 2_500),
    ]);
    return {
      firmwareVersion: firmware && firmware.length >= 2
        ? `${firmware[0]}.${String(firmware[1]).padStart(2, '0')}`
        : undefined,
      platform: platform?.[0],
      mcu: mcu?.[0],
      board: board?.[0],
      eepromBytes: rom?.byteLength,
    };
  }

  async requestProvisioning(payload: Uint8Array, timeoutMs = 8_000): Promise<Uint8Array> {
    return this.request(CMD_PROVISION_RESPONSE, payload, timeoutMs, CMD_PROVISION_REQUEST);
  }

  async readRadioConfig(): Promise<RNodeRadioConfig> {
    const [frequency, bandwidth, txPower, spreadingFactor, codingRate, eeprom] = await Promise.all([
      this.request(CMD_FREQUENCY, Uint8Array.of(0, 0, 0, 0), 1_500),
      this.request(CMD_BANDWIDTH, Uint8Array.of(0, 0, 0, 0), 1_500),
      this.request(CMD_TXPOWER, Uint8Array.of(0xff), 1_500),
      this.request(CMD_SF, Uint8Array.of(0xff), 1_500),
      this.request(CMD_CR, Uint8Array.of(0xff), 1_500),
      this.readEeprom(),
    ]);
    if (txPower.byteLength !== 1 || spreadingFactor.byteLength !== 1 || codingRate.byteLength !== 1) {
      throw new Error('RNODE_CONFIG_INVALID_RESPONSE');
    }
    return {
      bootMode: eeprom[EEPROM_CONFIG_OK_ADDRESS] === EEPROM_CONFIG_OK ? 'tnc' : 'host',
      frequency: decodeBe32(frequency),
      bandwidth: decodeBe32(bandwidth),
      spreadingFactor: spreadingFactor[0],
      codingRate: codingRate[0],
      txPower: new Int8Array(txPower.buffer, txPower.byteOffset, 1)[0],
      interferenceAvoidance: eeprom.byteLength > 0xb9 ? eeprom[0xb9] === 0 : true,
    };
  }

  async saveRadioConfig(config: RNodeRadioConfig): Promise<void> {
    if (config.bootMode === 'host') {
      await this.send(CMD_CONF_DELETE, Uint8Array.of(0));
      return;
    }
    assertIntegerRange(config.frequency, 100_000_000, 1_100_000_000);
    assertIntegerRange(config.bandwidth, 7_800, 1_625_000);
    assertIntegerRange(config.spreadingFactor, 5, 12);
    assertIntegerRange(config.codingRate, 5, 8);
    assertIntegerRange(config.txPower, -9, 37);
    const frequency = encodeBe32(config.frequency);
    const bandwidth = encodeBe32(config.bandwidth);
    await this.send(CMD_FREQUENCY, frequency);
    await this.send(CMD_BANDWIDTH, bandwidth);
    await this.send(CMD_SF, Uint8Array.of(config.spreadingFactor));
    await this.send(CMD_CR, Uint8Array.of(config.codingRate));
    await this.send(CMD_TXPOWER, Uint8Array.of(config.txPower));
    await this.send(CMD_DISABLE_INTERFERENCE_AVOIDANCE, Uint8Array.of(config.interferenceAvoidance ? 0 : 1));
    await this.send(CMD_RADIO_STATE, Uint8Array.of(1));
    await this.send(CMD_CONF_SAVE, Uint8Array.of(0));
  }

  async setBluetooth(mode: 0 | 1 | 2): Promise<void> {
    await this.send(CMD_BT_CTRL, Uint8Array.of(mode));
  }

  async unpairBluetooth(): Promise<void> {
    await this.send(CMD_BT_UNPAIR, Uint8Array.of(1));
  }

  async saveWifiConfig(config: Partial<RNodeWifiConfig>): Promise<void> {
    const values = Object.values(config);
    if (values.every((value) => value === undefined)) throw new Error('RNODE_CONFIG_NO_VALUES');
    if (config.mode !== undefined) assertIntegerRange(config.mode, 0, 2);
    if (config.channel !== undefined) assertIntegerRange(config.channel, 1, 13);
    const ssid = config.ssid === undefined ? undefined : encodeString(config.ssid);
    const psk = config.psk === undefined ? undefined : encodeString(config.psk);
    if (psk && psk.byteLength > 1 && psk.byteLength < 9) throw new Error('RNODE_CONFIG_WIFI_PSK_TOO_SHORT');
    const ip = config.ip === undefined ? undefined : encodeIpv4(config.ip);
    const netmask = config.netmask === undefined ? undefined : encodeIpv4(config.netmask);
    if (config.mode !== undefined) await this.send(CMD_WIFI_MODE, Uint8Array.of(config.mode));
    if (config.channel !== undefined) await this.send(CMD_WIFI_CHANNEL, Uint8Array.of(config.channel));
    if (ssid) await this.send(CMD_WIFI_SSID, ssid);
    if (psk) await this.send(CMD_WIFI_PSK, psk);
    if (ip) await this.send(CMD_WIFI_IP, ip);
    if (netmask) await this.send(CMD_WIFI_NETMASK, netmask);
  }

  async saveDisplayConfig(config: Partial<RNodeDisplayConfig>): Promise<void> {
    const values = Object.values(config);
    if (values.every((value) => value === undefined)) throw new Error('RNODE_CONFIG_NO_VALUES');
    if (config.intensity !== undefined) assertIntegerRange(config.intensity, 0, 255);
    if (config.blankingTimeout !== undefined) assertIntegerRange(config.blankingTimeout, 0, 255);
    if (config.rotation !== undefined) assertIntegerRange(config.rotation, 0, 3);
    if (config.address !== undefined) assertIntegerRange(config.address, 0, 255);
    if (config.neopixelIntensity !== undefined) assertIntegerRange(config.neopixelIntensity, 0, 255);
    if (config.intensity !== undefined) await this.send(CMD_DISPLAY_INTENSITY, Uint8Array.of(config.intensity));
    if (config.blankingTimeout !== undefined) await this.send(CMD_DISPLAY_BLANKING, Uint8Array.of(config.blankingTimeout));
    if (config.rotation !== undefined) await this.send(CMD_DISPLAY_ROTATION, Uint8Array.of(config.rotation));
    if (config.address !== undefined) await this.send(CMD_DISPLAY_ADDRESS, Uint8Array.of(config.address));
    if (config.neopixelIntensity !== undefined) await this.send(CMD_NEOPIXEL_INTENSITY, Uint8Array.of(config.neopixelIntensity));
  }

  async readEeprom(): Promise<Uint8Array> {
    return this.request(CMD_ROM_READ, Uint8Array.of(0), 3_000);
  }

  async restoreEeprom(backup: Uint8Array): Promise<Uint8Array> {
    if (backup.byteLength !== EEPROM_RESERVED_BYTES) throw new Error('RNODE_EEPROM_BACKUP_INVALID_SIZE');
    const current = await this.readEeprom();
    if (current.byteLength !== backup.byteLength) throw new Error('RNODE_EEPROM_BACKUP_DEVICE_SIZE_MISMATCH');
    if (current[EEPROM_INFO_LOCK_ADDRESS] === EEPROM_INFO_LOCK) throw new Error('RNODE_EEPROM_LOCKED');
    for (let address = 0; address < backup.byteLength; address += 1) {
      if (address !== EEPROM_INFO_LOCK_ADDRESS) {
        await this.send(CMD_ROM_WRITE, Uint8Array.of(address, backup[address]));
      }
    }
    await this.send(CMD_ROM_WRITE, Uint8Array.of(EEPROM_INFO_LOCK_ADDRESS, backup[EEPROM_INFO_LOCK_ADDRESS]));
    const restored = await this.readEeprom();
    if (restored.byteLength !== backup.byteLength || restored.some((byte, index) => byte !== backup[index])) {
      throw new Error('RNODE_EEPROM_RESTORE_VERIFICATION_FAILED');
    }
    return restored;
  }

  async wipeEeprom(): Promise<void> {
    await this.send(CMD_UNLOCK_ROM, Uint8Array.of(RESET_MARKER));
  }

  async reboot(): Promise<void> {
    await this.send(CMD_RESET, Uint8Array.of(RESET_MARKER));
  }

  async close(): Promise<void> {
    if (this.closing) return;
    this.closing = true;
    this.reconnectEnabled = false;
    this.clearReconnectTimer();
    await this.writeQueue.catch(() => undefined);
    await this.connection?.close(frame(CMD_LEAVE, Uint8Array.of(0xff))).catch(() => undefined);
    this.rejectWaiters(new Error('RNODE_MAINTENANCE_CLOSED'));
  }

  private async optionalRequest(command: number, payload: Uint8Array, timeoutMs = 1_000): Promise<Uint8Array | undefined> {
    try {
      return await this.request(command, payload, timeoutMs);
    } catch {
      return undefined;
    }
  }

  private async request(
    responseCommand: number,
    payload: Uint8Array,
    timeoutMs: number,
    requestCommand = responseCommand,
  ): Promise<Uint8Array> {
    const effectiveTimeoutMs = this.device.transport === 'ble' ? Math.max(timeoutMs, 5_000) : timeoutMs;
    const response = new Promise<Uint8Array>((resolve, reject) => {
      const timeout = setTimeout(() => {
        const queue = this.waiters.get(responseCommand);
        if (queue) this.waiters.set(responseCommand, queue.filter((item) => item.timeout !== timeout));
        reject(new Error('RNODE_MAINTENANCE_TIMEOUT'));
      }, effectiveTimeoutMs);
      const queue = this.waiters.get(responseCommand) ?? [];
      queue.push({ resolve, reject, timeout });
      this.waiters.set(responseCommand, queue);
    });
    await this.send(requestCommand, payload);
    return response;
  }

  private async send(command: number, payload: Uint8Array): Promise<void> {
    const connection = this.connection;
    if (!connection) throw new Error('RNODE_MAINTENANCE_NOT_OPEN');
    const operation = this.writeQueue.then(() => connection.write(frame(command, payload)));
    this.writeQueue = operation.catch(() => undefined);
    await operation;
  }

  private receive(data: Uint8Array): void {
    for (const received of this.deframer.process(data)) {
      if (received.command === CMD_LOG) {
        this.onLog(new TextDecoder().decode(received.payload));
        continue;
      }
      if (received.command === CMD_BT_PIN) {
        if (received.payload.byteLength === 4) {
          this.onBluetoothPin(decodeBe32(received.payload).toString().padStart(6, '0'));
        }
        continue;
      }
      const telemetry = parseRNodeTelemetry(received.command, received.payload);
      if (telemetry) {
        this.onTelemetry(telemetry);
        continue;
      }
      const queue = this.waiters.get(received.command);
      const waiter = queue?.shift();
      if (!waiter) continue;
      clearTimeout(waiter.timeout);
      if (queue?.length) this.waiters.set(received.command, queue);
      else this.waiters.delete(received.command);
      waiter.resolve(received.payload);
    }
  }

  private connectionClosed(): void {
    if (this.closing) return;
    this.rejectWaiters(new Error('RNODE_MAINTENANCE_CLOSED'));
    if (this.reconnectEnabled && this.device.transport === 'serial') {
      this.recoverSerialConnection();
    } else {
      this.onClosed();
    }
  }

  private recoverSerialConnection(): void {
    if (this.closing || this.reconnecting || this.reconnectTimer !== undefined) return;
    this.reconnecting = true;
    void this.connection?.close().catch(() => undefined).finally(() => {
      this.reconnecting = false;
      this.scheduleSerialReconnect();
    });
  }

  private scheduleSerialReconnect(error?: unknown): void {
    if (this.closing || !this.reconnectEnabled || this.reconnectTimer !== undefined) return;
    this.reconnectAttempt += 1;
    const delayMs = Math.min(
      SERIAL_RECONNECT_MAXIMUM_DELAY_MS,
      SERIAL_RECONNECT_INITIAL_DELAY_MS * SERIAL_RECONNECT_MULTIPLIER ** (this.reconnectAttempt - 1),
    );
    this.onConnectionEvent({
      type: 'reconnecting',
      attempt: this.reconnectAttempt,
      delayMs: Math.round(delayMs),
      ...(error === undefined ? {} : { error: error instanceof Error ? error.message : String(error) }),
    });
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      void this.reconnectSerialConnection();
    }, delayMs);
  }

  private async reconnectSerialConnection(): Promise<void> {
    if (this.closing || !this.reconnectEnabled || this.reconnecting) return;
    this.reconnecting = true;
    try {
      const info = await this.openConnection();
      if (this.closing) return;
      this.reconnectAttempt = 0;
      this.onConnectionEvent({ type: 'reconnected', info });
    } catch (error) {
      await this.connection?.close().catch(() => undefined);
      if (!this.closing) this.scheduleSerialReconnect(error);
    } finally {
      this.reconnecting = false;
    }
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
    this.reconnectAttempt = 0;
  }

  private rejectWaiters(error: Error): void {
    for (const queue of this.waiters.values()) {
      for (const waiter of queue) {
        clearTimeout(waiter.timeout);
        waiter.reject(error);
      }
    }
    this.waiters.clear();
  }
}

const localProvisioningNode = {
  id: 'local-rnode',
  destinationHash: '0'.repeat(32),
};

export class LocalProvisioningClient extends ProvisioningClient {
  private localSequence = 1;

  constructor(private readonly session: RNodeMaintenanceSession) {
    super(localProvisioningNode);
  }

  override close(): void {
    // The local byte session is shared by provisioning, device information, and logs.
  }

  override async reboot(): Promise<void> {
    try {
      await super.reboot();
    } catch (error) {
      if (!(error instanceof Error) || !['RNODE_MAINTENANCE_TIMEOUT', 'RNODE_MAINTENANCE_CLOSED'].includes(error.message)) {
        throw error;
      }
    }
  }

  protected override async request(
    operation: number,
    payload?: ProvisioningValue,
    _safeToRetry = true,
    responseTimeoutMs?: number,
  ): Promise<ProvisioningValue> {
    const sequence = this.localSequence++;
    const response = await this.session.requestProvisioning(
      encodeProvisioningRequest(operation, sequence, payload),
      responseTimeoutMs,
    );
    const envelope = decodeProvisioningEnvelope(response);
    if (envelope.sequence !== sequence) throw new Error('PROVISIONING_SEQUENCE_MISMATCH');
    return envelope.body;
  }
}
