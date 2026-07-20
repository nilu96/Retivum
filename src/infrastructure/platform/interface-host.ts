import type { InterfaceConfig, TcpInterfaceConfig, UdpInterfaceConfig } from '../../domain/settings';
import type { RuntimeCommand } from '../reticulum/protocol';
import { createTcpByteConnection, type ByteConnection } from './byte-connections';
import { encodeHdlcFrame, HdlcDeframer } from './hdlc';
import { interfaceIsSupported } from './interface-capabilities';
import { RNodeHost } from './rnode-host';
import { createUdpDatagramConnection, type DatagramConnection } from './datagram-connections';

interface HostedInterface {
  readonly managesWriteQueue?: boolean;
  open(): Promise<void>;
  write(data: Uint8Array, highPriority?: boolean): void | Promise<void>;
  close(): Promise<void>;
}

export class PlatformInterfaceHost {
  private readonly hosts = new Map<string, { host: HostedInterface; config: InterfaceConfig }>();
  private readonly writeQueues = new Map<string, Promise<void>>();
  private openQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly post: (command: RuntimeCommand) => void,
    private readonly log: (code: string, details?: Record<string, string | number | boolean>) => void,
  ) {}

  async open(config: InterfaceConfig): Promise<void> {
    const operation = this.openQueue.then(() => this.openNow(config));
    this.openQueue = operation.catch(() => undefined);
    return operation;
  }

  private async openNow(config: InterfaceConfig): Promise<void> {
    await this.closeNow(config.id);
    if (config.type === 'websocket') return;
    if (!interfaceIsSupported(config)) {
      this.post({ type: 'platformInterfaceState', id: config.id, state: 'error', errorCode: 'INTERFACE_PLATFORM_UNSUPPORTED' });
      return;
    }
    if (config.type === 'rnode' && config.connection.type === 'ble' && config.connection.deviceId) {
      const conflict = Array.from(this.hosts.values()).find(({ config: active }) => (
        active.type === 'rnode'
        && active.connection.type === 'ble'
        && active.connection.deviceId === config.connection.deviceId
      ));
      if (conflict) {
        this.log('RNODE_BLE_DEVICE_IN_USE', {
          interfaceId: config.id,
          conflictingInterfaceId: conflict.config.id,
          deviceId: config.connection.deviceId,
        });
        this.post({ type: 'platformInterfaceState', id: config.id, state: 'offline', errorCode: 'RNODE_BLE_DEVICE_IN_USE' });
        return;
      }
    }
    let host: HostedInterface;
    if (config.type === 'rnode') {
      host = new RNodeHost(config, {
          onPacket: (data) => this.post({ type: 'platformInterfaceData', id: config.id, data }),
          onState: (state, errorCode) => this.post({ type: 'platformInterfaceState', id: config.id, state, errorCode }),
          log: (code, details) => this.log(code, details),
        });
    } else if (config.type === 'tcp') {
      host = new TcpHost(config, this.post, this.log);
    } else {
      host = new UdpHost(config, this.post, this.log);
    }
    this.hosts.set(config.id, { host, config });
    await host.open();
  }

  async write(id: string, data: Uint8Array, highPriority = false): Promise<void> {
    const host = this.hosts.get(id)?.host;
    if (host?.managesWriteQueue) {
      await host.write(data, highPriority);
      return;
    }
    const operation = (this.writeQueues.get(id) ?? Promise.resolve()).then(async () => {
      await host?.write(data, highPriority);
    });
    const settled = operation.catch(() => undefined);
    this.writeQueues.set(id, settled);
    try {
      await operation;
    } finally {
      if (this.writeQueues.get(id) === settled) this.writeQueues.delete(id);
    }
  }

  async close(id: string): Promise<void> {
    const operation = this.openQueue.then(() => this.closeNow(id));
    this.openQueue = operation.catch(() => undefined);
    return operation;
  }

  private async closeNow(id: string): Promise<void> {
    await this.writeQueues.get(id);
    this.writeQueues.delete(id);
    const entry = this.hosts.get(id);
    this.hosts.delete(id);
    await entry?.host.close();
  }

  async closeAll(): Promise<void> {
    for (const id of Array.from(this.hosts.keys())) await this.close(id);
  }
}

class TcpHost implements HostedInterface {
  private readonly connection: ByteConnection;
  private readonly deframer = new HdlcDeframer();
  private closing = false;

  constructor(
    private readonly config: TcpInterfaceConfig,
    private readonly post: (command: RuntimeCommand) => void,
    private readonly log: (code: string, details?: Record<string, string | number | boolean>) => void,
  ) {
    this.connection = createTcpByteConnection(config);
  }

  async open(): Promise<void> {
    this.closing = false;
    this.deframer.reset();
    this.log('TCP_CONNECTING', {
      interfaceId: this.config.id,
      host: this.config.connection.host,
      port: this.config.connection.port,
    });
    try {
      await this.connection.open(
        (data) => {
          for (const packet of this.deframer.process(data)) {
            this.post({ type: 'platformInterfaceData', id: this.config.id, data: packet });
          }
        },
        () => { if (!this.closing) this.post({ type: 'platformInterfaceState', id: this.config.id, state: 'offline' }); },
      );
      this.log('TCP_CONNECTED', {
        interfaceId: this.config.id,
        host: this.config.connection.host,
        port: this.config.connection.port,
      });
      this.post({ type: 'platformInterfaceState', id: this.config.id, state: 'online' });
    } catch (error) {
      this.log('TCP_CONNECT_FAILED', {
        interfaceId: this.config.id,
        host: this.config.connection.host,
        port: this.config.connection.port,
        message: errorMessage(error),
      });
      this.post({ type: 'platformInterfaceState', id: this.config.id, state: 'error', errorCode: 'TCP_CONNECTION_FAILED' });
    }
  }

  async write(data: Uint8Array): Promise<void> {
    try {
      const frame = encodeHdlcFrame(data);
      await this.connection.write(frame);
    } catch (error) {
      this.log('TCP_WRITE_FAILED', {
        interfaceId: this.config.id,
        message: errorMessage(error),
      });
      this.post({ type: 'platformInterfaceState', id: this.config.id, state: 'error', errorCode: 'TCP_WRITE_FAILED' });
    }
  }

  async close(): Promise<void> {
    this.closing = true;
    this.deframer.reset();
    await this.connection.close().catch(() => undefined);
  }
}

class UdpHost implements HostedInterface {
  private readonly connection: DatagramConnection;
  private closing = false;

  get managesWriteQueue(): boolean {
    return this.connection.managesSendQueue;
  }

  constructor(
    private readonly config: UdpInterfaceConfig,
    private readonly post: (command: RuntimeCommand) => void,
    private readonly log: (code: string, details?: Record<string, string | number | boolean>) => void,
  ) {
    this.connection = createUdpDatagramConnection(config);
  }

  async open(): Promise<void> {
    this.closing = false;
    this.log('UDP_BINDING', this.endpointDetails());
    try {
      await this.connection.open(
        (data) => {
          if (data.byteLength === 0) return;
          this.post({ type: 'platformInterfaceData', id: this.config.id, data });
        },
        () => {
          if (!this.closing) this.post({ type: 'platformInterfaceState', id: this.config.id, state: 'offline' });
        },
      );
      this.log('UDP_BOUND', this.endpointDetails());
      this.post({ type: 'platformInterfaceState', id: this.config.id, state: 'online' });
    } catch (error) {
      this.log('UDP_BIND_FAILED', {
        ...this.endpointDetails(),
        message: errorMessage(error),
      });
      this.post({ type: 'platformInterfaceState', id: this.config.id, state: 'error', errorCode: 'UDP_BIND_FAILED' });
    }
  }

  async write(data: Uint8Array, highPriority = false): Promise<void> {
    try {
      await this.connection.send(data, highPriority);
    } catch (error) {
      this.log('UDP_WRITE_FAILED', {
        interfaceId: this.config.id,
        message: errorMessage(error),
      });
      this.post({ type: 'platformInterfaceState', id: this.config.id, state: 'error', errorCode: 'UDP_WRITE_FAILED' });
    }
  }

  async close(): Promise<void> {
    this.closing = true;
    await this.connection.close().catch(() => undefined);
  }

  private endpointDetails(): Record<string, string | number> {
    return {
      interfaceId: this.config.id,
      listenHost: this.config.connection.listenHost,
      listenPort: this.config.connection.listenPort,
      forwardHost: this.config.connection.forwardHost,
      forwardPort: this.config.connection.forwardPort,
    };
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
