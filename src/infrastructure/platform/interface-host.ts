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
  resume?(): Promise<void>;
}

export class PlatformInterfaceHost {
  private readonly hosts = new Map<string, { host: HostedInterface; config: InterfaceConfig; generation: number }>();
  private readonly lifecycleGenerations = new Map<string, number>();
  private readonly maintenanceClaims = new Set<string>();
  private readonly writeQueues = new Map<string, Promise<void>>();
  private openQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly post: (command: RuntimeCommand) => void,
    private readonly log: (code: string, details?: Record<string, string | number | boolean>) => void,
  ) {}

  async open(config: InterfaceConfig): Promise<void> {
    const generation = this.advanceLifecycle(config.id);
    const operation = this.openQueue.then(() => this.openNow(config, generation));
    this.openQueue = operation.catch(() => undefined);
    return operation;
  }

  private async openNow(config: InterfaceConfig, generation: number): Promise<void> {
    if (!this.isCurrentLifecycle(config.id, generation)) return;
    await this.closeNow(config.id);
    if (!this.isCurrentLifecycle(config.id, generation)) return;
    if (this.maintenanceClaims.has(config.id)) return;
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
          onTelemetry: (telemetry) => this.post({ type: 'platformInterfaceTelemetry', id: config.id, telemetry }),
          log: (code, details) => this.log(code, details),
        });
    } else if (config.type === 'tcp') {
      host = new TcpHost(config, this.post, this.log);
    } else {
      host = new UdpHost(config, this.post, this.log);
    }
    if (!this.isCurrentLifecycle(config.id, generation)) {
      await host.close().catch(() => undefined);
      return;
    }
    this.hosts.set(config.id, { host, config, generation });
    await host.open();
    if (
      !this.isCurrentLifecycle(config.id, generation)
      || this.hosts.get(config.id)?.host !== host
    ) {
      if (this.hosts.get(config.id)?.host === host) {
        this.hosts.delete(config.id);
        await host.close().catch(() => undefined);
      }
    }
  }

  async write(id: string, data: Uint8Array, highPriority = false): Promise<void> {
    const entry = this.hosts.get(id);
    const host = entry?.host;
    if (host?.managesWriteQueue) {
      await host.write(data, highPriority);
      return;
    }
    const operation = (this.writeQueues.get(id) ?? Promise.resolve()).then(async () => {
      if (!entry || this.hosts.get(id) !== entry) return;
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
    this.advanceLifecycle(id);
    await this.closeNow(id);
  }

  private async closeNow(id: string): Promise<void> {
    this.writeQueues.delete(id);
    const entry = this.hosts.get(id);
    this.hosts.delete(id);
    await entry?.host.close();
  }

  async closeAll(): Promise<void> {
    const ids = new Set([...this.lifecycleGenerations.keys(), ...this.hosts.keys()]);
    await Promise.all(Array.from(ids, (id) => this.close(id)));
  }

  async resume(): Promise<void> {
    await Promise.all(Array.from(this.hosts.values(), ({ host }) => host.resume?.()));
  }

  async claimForMaintenance(id: string): Promise<void> {
    this.maintenanceClaims.add(id);
    await this.close(id);
  }

  async releaseFromMaintenance(id: string, config?: InterfaceConfig): Promise<void> {
    this.maintenanceClaims.delete(id);
    if (config?.enabled) await this.open(config);
  }

  private advanceLifecycle(id: string): number {
    const generation = (this.lifecycleGenerations.get(id) ?? 0) + 1;
    this.lifecycleGenerations.set(id, generation);
    return generation;
  }

  private isCurrentLifecycle(id: string, generation: number): boolean {
    return this.lifecycleGenerations.get(id) === generation;
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
