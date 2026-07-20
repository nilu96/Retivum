import { Capacitor, type PluginListenerHandle } from '@capacitor/core';
import { UdpSocket } from 'capacitor-udp-socket';
import type { UdpInterfaceConfig } from '../../domain/settings';

const UDP_BUFFER_SIZE = 4_096;
const IOS_SEND_BATCH_SIZE = 32;
const IOS_SEND_BATCH_DELAY_MS = 1;

interface ReceiveBatchEvent {
  packets?: Array<{ socketId: number; buffer?: string }>;
}

interface SendBatchResult {
  bytesSent: number;
  packetsSent: number;
}

const BatchedUdpSocket = UdpSocket as typeof UdpSocket & {
  sendBatch(options: {
    socketId: number;
    address: string;
    port: number;
    buffers: string[];
  }): Promise<SendBatchResult>;
  addListener(
    eventName: 'receiveBatch',
    listenerFunc: (event: ReceiveBatchEvent) => void,
  ): Promise<PluginListenerHandle>;
};

export interface DatagramConnection {
  readonly managesSendQueue: boolean;
  open(onData: (data: Uint8Array) => void, onClosed: () => void): Promise<void>;
  send(data: Uint8Array, highPriority?: boolean): Promise<void>;
  close(): Promise<void>;
}

export function createUdpDatagramConnection(config: UdpInterfaceConfig): DatagramConnection {
  if (window.retivumDesktopUdpSockets) return new DesktopUdpDatagramConnection(config);
  if (Capacitor.isNativePlatform()) return new CapacitorUdpDatagramConnection(config);
  throw new Error('UDP_BRIDGE_UNAVAILABLE');
}

class DesktopUdpDatagramConnection implements DatagramConnection {
  readonly managesSendQueue = false;
  private removeListener?: () => void;
  private readonly bridge = window.retivumDesktopUdpSockets;

  constructor(private readonly config: UdpInterfaceConfig) {}

  async open(onData: (data: Uint8Array) => void, onClosed: () => void): Promise<void> {
    if (!this.bridge) throw new Error('UDP_BRIDGE_UNAVAILABLE');
    this.removeListener = this.bridge.onEvent((event) => {
      if (event.id !== this.config.id) return;
      if (event.type === 'data' && event.data) onData(Uint8Array.from(event.data));
      if (event.type === 'closed' || event.type === 'error') onClosed();
    });
    await this.bridge.open({ id: this.config.id, ...this.config.connection });
  }

  async send(data: Uint8Array): Promise<void> {
    if (!this.bridge) throw new Error('UDP_BRIDGE_UNAVAILABLE');
    await this.bridge.send({ id: this.config.id, data: Array.from(data) });
  }

  async close(): Promise<void> {
    this.removeListener?.();
    this.removeListener = undefined;
    if (this.bridge) await this.bridge.close({ id: this.config.id });
  }
}

class CapacitorUdpDatagramConnection implements DatagramConnection {
  readonly managesSendQueue = Capacitor.getPlatform() === 'ios';
  private socketId?: number;
  private listeners: PluginListenerHandle[] = [];
  private closing = false;
  private sendQueue: Array<{
    data: Uint8Array;
    resolve: () => void;
    reject: (error: unknown) => void;
  }> = [];
  private sendTimer?: ReturnType<typeof setTimeout>;
  private flushPromise?: Promise<void>;

  constructor(private readonly config: UdpInterfaceConfig) {}

  async open(onData: (data: Uint8Array) => void, onClosed: () => void): Promise<void> {
    this.closing = false;
    const created = await UdpSocket.create({
      properties: { name: this.config.name, bufferSize: UDP_BUFFER_SIZE },
    });
    this.socketId = created.socketId;
    if (this.managesSendQueue) {
      this.listeners.push(await BatchedUdpSocket.addListener('receiveBatch', (event) => {
        for (const packet of event.packets ?? []) {
          if (packet.socketId !== this.socketId || !packet.buffer) continue;
          onData(decodeBase64(packet.buffer));
        }
      }));
    } else {
      this.listeners.push(await UdpSocket.addListener('receive', (event) => {
        if (event.socketId !== this.socketId || !event.buffer) return;
        onData(decodeBase64(event.buffer));
      }));
    }
    this.listeners.push(await UdpSocket.addListener('receiveError', (event) => {
      if (event.socketId === this.socketId && !this.closing) onClosed();
    }));
    if (isIpv4Broadcast(this.config.connection.forwardHost)) {
      await UdpSocket.setBroadcast({ socketId: this.socketId, enabled: true });
    }
    await UdpSocket.bind({
      socketId: this.socketId,
      address: this.config.connection.listenHost,
      port: this.config.connection.listenPort,
    });
  }

  async send(data: Uint8Array, highPriority = false): Promise<void> {
    if (this.socketId === undefined || this.closing) throw new Error('UDP_SOCKET_NOT_OPEN');
    if (this.managesSendQueue) {
      return new Promise<void>((resolve, reject) => {
        this.sendQueue.push({ data, resolve, reject });
        if (highPriority || this.sendQueue.length >= IOS_SEND_BATCH_SIZE) void this.flushSends();
        else if (this.sendTimer === undefined) {
          this.sendTimer = setTimeout(() => {
            this.sendTimer = undefined;
            void this.flushSends();
          }, IOS_SEND_BATCH_DELAY_MS);
        }
      });
    }
    const result = await UdpSocket.send({
      socketId: this.socketId,
      address: this.config.connection.forwardHost,
      port: this.config.connection.forwardPort,
      buffer: encodeBase64(data),
    });
    if (result.bytesSent !== data.byteLength) throw new Error('UDP_WRITE_INCOMPLETE');
  }

  async close(): Promise<void> {
    this.closing = true;
    if (this.sendTimer !== undefined) clearTimeout(this.sendTimer);
    this.sendTimer = undefined;
    if (this.sendQueue.length > 0) await this.flushSends().catch(() => undefined);
    await this.flushPromise?.catch(() => undefined);
    for (const listener of this.listeners) await listener.remove().catch(() => undefined);
    this.listeners = [];
    const socketId = this.socketId;
    this.socketId = undefined;
    if (socketId !== undefined) await UdpSocket.close({ socketId }).catch(() => undefined);
  }

  private async flushSends(): Promise<void> {
    if (this.flushPromise) return this.flushPromise;
    if (this.sendTimer !== undefined) clearTimeout(this.sendTimer);
    this.sendTimer = undefined;
    const operation = this.flushSendBatches();
    this.flushPromise = operation;
    try {
      await operation;
    } finally {
      this.flushPromise = undefined;
      if (this.sendQueue.length > 0 && !this.closing) void this.flushSends();
    }
  }

  private async flushSendBatches(): Promise<void> {
    while (this.sendQueue.length > 0) {
      const socketId = this.socketId;
      if (socketId === undefined) {
        const error = new Error('UDP_SOCKET_NOT_OPEN');
        for (const pending of this.sendQueue.splice(0)) pending.reject(error);
        throw error;
      }
      const batch = this.sendQueue.splice(0, IOS_SEND_BATCH_SIZE);
      try {
        const result = await BatchedUdpSocket.sendBatch({
          socketId,
          address: this.config.connection.forwardHost,
          port: this.config.connection.forwardPort,
          buffers: batch.map(({ data }) => encodeBase64(data)),
        });
        const expectedBytes = batch.reduce((total, { data }) => total + data.byteLength, 0);
        if (result.packetsSent !== batch.length || result.bytesSent !== expectedBytes) {
          throw new Error('UDP_WRITE_INCOMPLETE');
        }
        for (const pending of batch) pending.resolve();
      } catch (error) {
        for (const pending of batch) pending.reject(error);
      }
    }
  }
}

function isIpv4Broadcast(host: string): boolean {
  const normalized = host.trim();
  return normalized === '255.255.255.255' || /^\d{1,3}(?:\.\d{1,3}){2}\.255$/.test(normalized);
}

function encodeBase64(data: Uint8Array): string {
  let binary = '';
  for (const byte of data) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value.replace(/\s/g, ''));
  const data = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) data[index] = binary.charCodeAt(index);
  return data;
}
