import type { RNodeInterfaceConfig } from '../../domain/settings';
import type { RNodeBatteryState, RNodeInterfaceTelemetry } from '../reticulum/protocol';
import { createRNodeByteConnection, type ByteConnection } from './byte-connections';

const FEND = 0xc0;
const FESC = 0xdb;
const TFEND = 0xdc;
const TFESC = 0xdd;
const CMD_DATA = 0x00;
const CMD_FREQUENCY = 0x01;
const CMD_BANDWIDTH = 0x02;
const CMD_TXPOWER = 0x03;
const CMD_SF = 0x04;
const CMD_CR = 0x05;
const CMD_RADIO_STATE = 0x06;
const CMD_DETECT = 0x08;
const CMD_LEAVE = 0x0a;
const CMD_LT_ALOCK = 0x0c;
const CMD_READY = 0x0f;
const CMD_STAT_RX = 0x21;
const CMD_STAT_TX = 0x22;
const CMD_STAT_RSSI = 0x23;
const CMD_STAT_SNR = 0x24;
const CMD_STAT_CHTM = 0x25;
const CMD_STAT_BAT = 0x27;
const CMD_FW_VERSION = 0x50;
const CMD_RESET = 0x55;
const CMD_ERROR = 0x90;
const DETECT_REQ = 0x73;
const DETECT_RESP = 0x46;
const RADIO_STATE_OFF = 0x00;
const RADIO_STATE_ON = 0x01;
const DEVICE_RESET_MARKER = 0xf8;
const HW_MTU = 508;
const RECONNECT_INITIAL_DELAY_MS = 3_500;
const RECONNECT_MAXIMUM_DELAY_MS = 30_000;
const RECONNECT_MULTIPLIER = 1.8;
const RECONNECT_JITTER = 0.2;

interface RadioConfirmation {
  frequency?: number;
  bandwidth?: number;
  txPower?: number;
  spreadingFactor?: number;
  codingRate?: number;
  longAirtimeLimit?: number;
  radioState?: number;
}

export interface RNodeHostHooks {
  onPacket(data: Uint8Array): void;
  onState(state: 'online' | 'offline' | 'error', errorCode?: string): void;
  onTelemetry?(telemetry: RNodeInterfaceTelemetry): void;
  log(code: string, details?: Record<string, string | number | boolean>): void;
}

export class RNodeHost {
  private readonly connection: ByteConnection;
  private readonly deframer = new KissDeframer(HW_MTU);
  private readonly waiters = new Set<() => void>();
  private detected = false;
  private firmware?: [number, number];
  private confirmation?: RadioConfirmation;
  private online = false;
  private closing = false;
  private ready = true;
  private sending = false;
  private queue: Array<{ packet: Uint8Array; highPriority: boolean }> = [];
  private sendTimer?: ReturnType<typeof setTimeout>;
  private flowTimer?: ReturnType<typeof setTimeout>;
  private heartbeat?: ReturnType<typeof setInterval>;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private reconnectAttempt = 0;
  private opening = false;
  private recovering = false;
  private connectionGeneration = 0;

  constructor(
    private readonly config: RNodeInterfaceConfig,
    private readonly hooks: RNodeHostHooks,
    connection?: ByteConnection,
  ) {
    this.connection = connection ?? createRNodeByteConnection(config, hooks.log);
  }

  async open(): Promise<void> {
    this.closing = false;
    await this.connect();
  }

  private async connect(): Promise<void> {
    if (this.closing || this.opening) return;
    this.opening = true;
    const generation = ++this.connectionGeneration;
    try {
      await this.connection.open((data) => this.receive(data), () => this.connectionClosed());
      this.hooks.log('RNODE_TRANSPORT_READY', { interfaceId: this.config.id, transport: this.config.connection.type });
      await sleep(2_000);
      await this.detect();
      await this.configureRadio();
      await sleep(300);
      if (this.closing || generation !== this.connectionGeneration) return;
      this.online = true;
      this.ready = true;
      this.recovering = false;
      this.reconnectAttempt = 0;
      this.startHeartbeat();
      this.hooks.onState('online');
      this.hooks.log('RNODE_ONLINE', { interfaceId: this.config.id, firmware: `${this.firmware?.[0]}.${this.firmware?.[1]}` });
    } catch (error) {
      if (this.closing || generation !== this.connectionGeneration) return;
      this.hooks.log('RNODE_CONNECT_FAILED', { interfaceId: this.config.id, message: errorMessage(error) });
      await this.closeConnection();
      if (!this.closing) {
        this.hooks.onState('offline', errorCode(error));
        this.scheduleReconnect();
      }
    } finally {
      this.opening = false;
    }
  }

  send(packet: Uint8Array, highPriority = false): void {
    if (!this.online) return;
    if (packet.byteLength > HW_MTU) {
      this.hooks.log('RNODE_PACKET_OVER_MTU', { interfaceId: this.config.id, bytes: packet.byteLength });
      return;
    }
    if (this.queue.length >= 64) this.queue.shift();
    const item = { packet: Uint8Array.from(packet), highPriority };
    if (highPriority) {
      const index = this.queue.findIndex((queued) => !queued.highPriority);
      this.queue.splice(index < 0 ? this.queue.length : index, 0, item);
    } else {
      this.queue.push(item);
    }
    if (highPriority) void this.flush();
    else if (!this.sendTimer) this.sendTimer = setTimeout(() => { this.sendTimer = undefined; void this.flush(); }, Math.random() * 500);
  }

  write(packet: Uint8Array, highPriority = false): void {
    this.send(packet, highPriority);
  }

  async close(): Promise<void> {
    this.closing = true;
    this.connectionGeneration += 1;
    this.online = false;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
    this.clearTimers();
    try {
      await this.connection.write(concat([frame(CMD_RADIO_STATE, [RADIO_STATE_OFF]), frame(CMD_LEAVE, [0xff])]));
    } catch { /* best effort */ }
    await this.closeConnection();
  }

  private async detect(): Promise<void> {
    this.detected = false;
    this.firmware = undefined;
    this.hooks.log('RNODE_KISS_DETECT_SENT', { interfaceId: this.config.id });
    await this.connection.write(new Uint8Array([
      FEND, CMD_DETECT, DETECT_REQ,
      FEND, CMD_FW_VERSION, 0,
      FEND,
    ]));
    await this.waitFor(() => this.detected && this.firmware !== undefined, this.config.connection.type === 'ble' ? 5_000 : 1_000, 'RNODE_DETECT_TIMEOUT');
    const [major, minor] = this.firmware!;
    this.hooks.log('RNODE_KISS_DETECT_CONFIRMED', { interfaceId: this.config.id, firmware: `${major}.${minor}` });
    if (major < 1 || (major === 1 && minor < 52)) throw new Error('RNODE_FIRMWARE_UNSUPPORTED');
  }

  private async configureRadio(): Promise<void> {
    const radio = this.config.radio;
    this.confirmation = {};
    this.hooks.log('RNODE_RADIO_CONFIGURATION_SENT', { interfaceId: this.config.id });
    await this.connection.write(concat([
      frame(CMD_FREQUENCY, u32(radio.frequency)),
      frame(CMD_BANDWIDTH, u32(radio.bandwidth)),
      frame(CMD_TXPOWER, [radio.txPower]),
      frame(CMD_SF, [radio.spreadingFactor]),
      frame(CMD_CR, [radio.codingRate]),
      frame(CMD_LT_ALOCK, u16(Math.trunc(radio.dutyCycle * 100))),
      frame(CMD_RADIO_STATE, [RADIO_STATE_ON]),
    ]));
    await sleep(this.config.connection.type === 'ble' ? 1_000 : 250);
    await this.waitFor(() => Object.keys(this.confirmation ?? {}).length > 0, 2_000, 'RNODE_CONFIG_TIMEOUT');
    const confirmation = this.confirmation;
    if (!confirmation) throw new Error('RNODE_CONFIG_TIMEOUT');
    if (confirmation.frequency !== undefined && Math.abs(confirmation.frequency - radio.frequency) > 100) throw new Error('RNODE_CONFIG_MISMATCH');
    if (confirmation.bandwidth !== undefined && confirmation.bandwidth !== radio.bandwidth) throw new Error('RNODE_CONFIG_MISMATCH');
    if (confirmation.txPower !== undefined && confirmation.txPower !== radio.txPower) throw new Error('RNODE_CONFIG_MISMATCH');
    if (confirmation.spreadingFactor !== undefined && confirmation.spreadingFactor !== radio.spreadingFactor) throw new Error('RNODE_CONFIG_MISMATCH');
    if (confirmation.codingRate !== undefined && confirmation.codingRate !== radio.codingRate) throw new Error('RNODE_CONFIG_MISMATCH');
    if (confirmation.longAirtimeLimit !== undefined && Math.abs(confirmation.longAirtimeLimit - radio.dutyCycle) >= 0.01) throw new Error('RNODE_CONFIG_MISMATCH');
    if (confirmation.radioState === RADIO_STATE_OFF) throw new Error('RNODE_CONFIG_MISMATCH');
    this.hooks.log('RNODE_RADIO_CONFIGURATION_CONFIRMED', { interfaceId: this.config.id });
  }

  private receive(bytes: Uint8Array): void {
    for (const { command, payload } of this.deframer.process(bytes)) {
      if (command === CMD_DETECT && payload[0] === DETECT_RESP) this.detected = true;
      else if (command === CMD_FW_VERSION && payload.length >= 2) this.firmware = [payload[0], payload[1]];
      else if (command === CMD_DATA && payload.byteLength) this.hooks.onPacket(payload);
      else if (command === CMD_READY) {
        this.ready = true;
        if (this.flowTimer) clearTimeout(this.flowTimer);
        this.flowTimer = undefined;
        void this.flush();
      } else if (command === CMD_RESET && payload[0] === DEVICE_RESET_MARKER) {
        this.recoverConnection('RNODE_DEVICE_RESET');
      } else if (command === CMD_ERROR) {
        this.hooks.log('RNODE_DEVICE_ERROR', { interfaceId: this.config.id, code: payload[0] ?? -1 });
      }
      this.applyTelemetry(command, payload);
      this.applyConfirmation(command, payload);
      for (const waiter of Array.from(this.waiters)) waiter();
    }
  }

  private applyTelemetry(command: number, payload: Uint8Array): void {
    const telemetry = parseRNodeTelemetry(command, payload);
    if (telemetry) this.hooks.onTelemetry?.(telemetry);
  }

  private applyConfirmation(command: number, payload: Uint8Array): void {
    if (!this.confirmation) return;
    if (command === CMD_FREQUENCY && payload.length >= 4) this.confirmation.frequency = readU32(payload);
    if (command === CMD_BANDWIDTH && payload.length >= 4) this.confirmation.bandwidth = readU32(payload);
    if (command === CMD_TXPOWER && payload.length) this.confirmation.txPower = payload[0];
    if (command === CMD_SF && payload.length) this.confirmation.spreadingFactor = payload[0];
    if (command === CMD_CR && payload.length) this.confirmation.codingRate = payload[0];
    if (command === CMD_LT_ALOCK && payload.length >= 2) this.confirmation.longAirtimeLimit = readU16(payload) / 100;
    if (command === CMD_RADIO_STATE && payload.length) this.confirmation.radioState = payload[0];
  }

  private waitFor(predicate: () => boolean, timeoutMs: number, code: string): Promise<void> {
    if (predicate()) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const check = () => {
        if (!predicate()) return;
        clearTimeout(timeout);
        this.waiters.delete(check);
        resolve();
      };
      const timeout = setTimeout(() => { this.waiters.delete(check); reject(new Error(code)); }, timeoutMs);
      this.waiters.add(check);
    });
  }

  private async flush(): Promise<void> {
    if (this.sending || !this.online || (this.config.radio.flowControl && !this.ready)) return;
    const queued = this.queue.shift();
    if (!queued) return;
    this.sending = true;
    try {
      await this.connection.write(frame(CMD_DATA, queued.packet));
      if (this.config.radio.flowControl) {
        this.ready = false;
        this.flowTimer = setTimeout(() => { this.ready = true; this.flowTimer = undefined; void this.flush(); }, 5_000);
      }
    } catch (error) {
      this.hooks.log('RNODE_WRITE_FAILED', { interfaceId: this.config.id, message: errorMessage(error) });
      this.recoverConnection('RNODE_WRITE_FAILED');
    } finally {
      this.sending = false;
    }
    if (this.online && this.queue.length) {
      this.sendTimer = setTimeout(() => { this.sendTimer = undefined; void this.flush(); }, 50);
    }
  }

  private startHeartbeat(): void {
    this.heartbeat = setInterval(() => {
      if (!this.online) return;
      void this.connection.write(frame(CMD_DETECT, [DETECT_REQ])).catch((error) => {
        this.hooks.log('RNODE_HEARTBEAT_FAILED', {
          interfaceId: this.config.id,
          message: errorMessage(error),
        });
        this.recoverConnection('RNODE_HEARTBEAT_FAILED');
      });
    }, 300_000);
  }

  private connectionClosed(): void {
    this.recoverConnection();
  }

  private recoverConnection(errorCode?: string): void {
    if (this.closing || this.opening || this.recovering || this.reconnectTimer !== undefined) return;
    this.recovering = true;
    this.online = false;
    this.clearTimers();
    this.hooks.onState('offline', errorCode);
    void this.closeConnection().finally(() => {
      this.recovering = false;
      this.scheduleReconnect();
    });
  }

  private scheduleReconnect(): void {
    if (this.closing || this.reconnectTimer) return;
    this.reconnectAttempt += 1;
    const base = Math.min(
      RECONNECT_MAXIMUM_DELAY_MS,
      RECONNECT_INITIAL_DELAY_MS * RECONNECT_MULTIPLIER ** (this.reconnectAttempt - 1),
    );
    const jitter = base * RECONNECT_JITTER * (Math.random() * 2 - 1);
    const delay = Math.max(0, base + jitter);
    this.hooks.log('RNODE_RECONNECT_SCHEDULED', {
      interfaceId: this.config.id,
      attempt: this.reconnectAttempt,
      delayMs: Math.round(delay),
    });
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      void this.connect();
    }, delay);
  }

  private async closeConnection(): Promise<void> {
    this.clearTimers();
    await this.connection.close().catch(() => undefined);
  }

  private clearTimers(): void {
    if (this.sendTimer) clearTimeout(this.sendTimer);
    if (this.flowTimer) clearTimeout(this.flowTimer);
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.sendTimer = undefined;
    this.flowTimer = undefined;
    this.heartbeat = undefined;
  }
}

export class KissDeframer {
  private inFrame = false;
  private escaped = false;
  private command?: number;
  private payload: number[] = [];
  constructor(private readonly maxPayload: number) {}

  process(bytes: Uint8Array): Array<{ command: number; payload: Uint8Array }> {
    const frames: Array<{ command: number; payload: Uint8Array }> = [];
    for (const byte of bytes) {
      if (byte === FEND) {
        if (this.inFrame && this.command !== undefined) frames.push({ command: this.command, payload: Uint8Array.from(this.payload) });
        this.inFrame = true;
        this.escaped = false;
        this.command = undefined;
        this.payload = [];
      } else if (this.inFrame && this.command === undefined) {
        this.command = byte;
      } else if (this.inFrame && this.escaped) {
        this.payload.push(byte === TFEND ? FEND : byte === TFESC ? FESC : byte);
        this.escaped = false;
      } else if (this.inFrame && byte === FESC) {
        this.escaped = true;
      } else if (this.inFrame) {
        this.payload.push(byte);
      }
      if (this.payload.length > this.maxPayload) {
        this.inFrame = false;
        this.command = undefined;
        this.payload = [];
      }
    }
    return frames;
  }
}

export function frame(command: number, payload: ArrayLike<number>): Uint8Array {
  const escaped: number[] = [];
  for (let index = 0; index < payload.length; index += 1) {
    const byte = payload[index];
    if (byte === FEND) escaped.push(FESC, TFEND);
    else if (byte === FESC) escaped.push(FESC, TFESC);
    else escaped.push(byte);
  }
  return new Uint8Array([FEND, command, ...escaped, FEND]);
}

function concat(parts: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.byteLength; }
  return result;
}

function u32(value: number): number[] {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}

function u16(value: number): number[] {
  return [(value >>> 8) & 0xff, value & 0xff];
}

function readU16(value: Uint8Array): number {
  return (value[0] << 8) | value[1];
}

function readU32(value: Uint8Array): number {
  return ((value[0] * 0x1000000) + ((value[1] << 16) | (value[2] << 8) | value[3])) >>> 0;
}

export function parseRNodeTelemetry(command: number, payload: Uint8Array): RNodeInterfaceTelemetry | undefined {
  if (command === CMD_STAT_RX && payload.length >= 4) return { radioRxPackets: readU32(payload) };
  if (command === CMD_STAT_TX && payload.length >= 4) return { radioTxPackets: readU32(payload) };
  if (command === CMD_STAT_RSSI && payload.length) return { lastPacketRssiDbm: payload[0] - 157 };
  if (command === CMD_STAT_SNR && payload.length) {
    const signed = payload[0] > 127 ? payload[0] - 256 : payload[0];
    return { lastPacketSnrDb: signed * 0.25 };
  }
  if (command === CMD_STAT_CHTM && payload.length >= 8) {
    return {
      airtimeShortPercent: readU16(payload) / 100,
      airtimeLongPercent: readU16(payload.subarray(2)) / 100,
      channelLoadShortPercent: readU16(payload.subarray(4)) / 100,
      channelLoadLongPercent: readU16(payload.subarray(6)) / 100,
      ...(payload.length >= 11 ? {
        currentRssiDbm: payload[8] - 157,
        noiseFloorDbm: payload[9] - 157,
        interferenceDbm: payload[10] === 0xff ? undefined : payload[10] - 157,
      } : {}),
    };
  }
  if (command === CMD_STAT_BAT && payload.length >= 2) {
    return { batteryState: batteryState(payload[0]), batteryPercent: Math.min(100, payload[1]) };
  }
  return undefined;
}

function batteryState(value: number): RNodeBatteryState {
  if (value === 1) return 'discharging';
  if (value === 2) return 'charging';
  if (value === 3) return 'charged';
  return 'unknown';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function errorCode(error: unknown): string {
  const message = errorMessage(error);
  return /^[A-Z0-9_]+$/.test(message) ? message : 'RNODE_CONNECTION_FAILED';
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
