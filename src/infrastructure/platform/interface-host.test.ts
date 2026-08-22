import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTcpInterfaceDraft, createUdpInterfaceDraft } from '../../domain/settings';

const transport = vi.hoisted(() => {
  let releaseFirstOpen: (() => void) | undefined;
  let rejectFirstOpen: ((error: Error) => void) | undefined;
  let releaseBlockedWrite: (() => void) | undefined;
  let releaseBlockedClose: (() => void) | undefined;
  let releaseBlockedHealthCheck: (() => void) | undefined;
  let blockNextWrite = false;
  let blockNextClose = false;
  let blockNextHealthCheck = false;
  let failFirstWhenClosed = false;
  return {
    events: [] as string[],
    connectionCount: 0,
    connected: true,
    healthChecks: 0,
    reset() {
      this.events = [];
      this.connectionCount = 0;
      this.connected = true;
      this.healthChecks = 0;
      releaseFirstOpen = undefined;
      rejectFirstOpen = undefined;
      releaseBlockedWrite = undefined;
      releaseBlockedClose = undefined;
      releaseBlockedHealthCheck = undefined;
      blockNextWrite = false;
      blockNextClose = false;
      blockNextHealthCheck = false;
      failFirstWhenClosed = false;
    },
    releaseFirst() {
      releaseFirstOpen?.();
    },
    blockWrite() {
      blockNextWrite = true;
    },
    blockClose() {
      blockNextClose = true;
    },
    blockHealthCheck() {
      blockNextHealthCheck = true;
    },
    failOpeningConnectionWhenClosed() {
      failFirstWhenClosed = true;
    },
    releaseWrite() {
      releaseBlockedWrite?.();
    },
    releaseClose() {
      releaseBlockedClose?.();
    },
    releaseHealthCheck() {
      releaseBlockedHealthCheck?.();
    },
    create() {
      const number = ++this.connectionCount;
      return {
        async open() {
          transport.events.push(`open:${number}:start`);
          if (number === 1) {
            await new Promise<void>((resolve, reject) => {
              releaseFirstOpen = resolve;
              rejectFirstOpen = reject;
            });
          }
          transport.events.push(`open:${number}:end`);
        },
        async write() {
          transport.events.push(`write:${number}:start`);
          if (blockNextWrite) {
            blockNextWrite = false;
            await new Promise<void>((resolve) => { releaseBlockedWrite = resolve; });
          }
          transport.events.push(`write:${number}:end`);
        },
        async close() {
          if (blockNextClose) {
            blockNextClose = false;
            transport.events.push(`close:${number}:start`);
            await new Promise<void>((resolve) => { releaseBlockedClose = resolve; });
            transport.events.push(`close:${number}:end`);
          } else {
            transport.events.push(`close:${number}`);
          }
          if (number === 1) {
            if (failFirstWhenClosed) rejectFirstOpen?.(new Error('obsolete open failed'));
            else releaseFirstOpen?.();
          }
        },
        async isConnected() {
          transport.healthChecks += 1;
          if (blockNextHealthCheck) {
            blockNextHealthCheck = false;
            await new Promise<void>((resolve) => { releaseBlockedHealthCheck = resolve; });
          }
          return transport.connected;
        },
      };
    },
  };
});

const datagram = vi.hoisted(() => ({
  onData: undefined as ((data: Uint8Array) => void) | undefined,
  onClosed: undefined as (() => void) | undefined,
  sent: [] as Uint8Array[],
  reset() {
    this.onData = undefined;
    this.onClosed = undefined;
    this.sent = [];
  },
    create() {
      return {
        managesSendQueue: false,
        async open(onData: (data: Uint8Array) => void, onClosed: () => void) {
        datagram.onData = onData;
        datagram.onClosed = onClosed;
      },
      async send(data: Uint8Array) { datagram.sent.push(data); },
      async close() {},
    };
  },
}));

vi.mock('./byte-connections', () => ({
  createTcpByteConnection: () => transport.create(),
}));

vi.mock('./datagram-connections', () => ({
  createUdpDatagramConnection: () => datagram.create(),
}));

vi.mock('./interface-capabilities', () => ({
  interfaceIsSupported: () => true,
}));

import { PlatformInterfaceHost } from './interface-host';

describe('platform interface lifecycle', () => {
  beforeEach(() => {
    transport.reset();
    datagram.reset();
  });

  it('interrupts an in-flight native connection before opening its replacement', async () => {
    const config = createTcpInterfaceDraft('tcp-ios');
    const host = new PlatformInterfaceHost(() => undefined, () => undefined);

    const firstOpen = host.open(config);
    await vi.waitFor(() => expect(transport.events).toEqual(['open:1:start']));

    const close = host.close(config.id);
    await close;
    expect(transport.events).toEqual(['open:1:start', 'close:1', 'open:1:end']);

    const retryOpen = host.open(config);
    await Promise.all([firstOpen, close, retryOpen]);

    expect(transport.events).toEqual([
      'open:1:start',
      'close:1',
      'open:1:end',
      'open:2:start',
      'open:2:end',
    ]);
  });

  it('cancels a queued open when an interface is disabled before it starts', async () => {
    const first = createTcpInterfaceDraft('tcp-one');
    const disabledBeforeOpen = createTcpInterfaceDraft('tcp-two');
    const host = new PlatformInterfaceHost(() => undefined, () => undefined);

    const firstOpen = host.open(first);
    await vi.waitFor(() => expect(transport.events).toEqual(['open:1:start']));
    const obsoleteOpen = host.open(disabledBeforeOpen);
    await host.close(disabledBeforeOpen.id);

    transport.releaseFirst();
    await Promise.all([firstOpen, obsoleteOpen]);

    expect(transport.connectionCount).toBe(1);
    expect(transport.events).not.toContain('open:2:start');
  });

  it('waits for native teardown before reconnecting the same interface', async () => {
    const config = createTcpInterfaceDraft('tcp-overlap');
    const host = new PlatformInterfaceHost(() => undefined, () => undefined);

    const initialOpen = host.open(config);
    await vi.waitFor(() => expect(transport.events).toEqual(['open:1:start']));
    transport.releaseFirst();
    await initialOpen;

    transport.blockClose();
    const closing = host.close(config.id);
    await vi.waitFor(() => expect(transport.events).toContain('close:1:start'));
    const reopening = host.open(config);
    await Promise.resolve();

    expect(transport.events).not.toContain('open:2:start');
    transport.releaseClose();
    await Promise.all([closing, reopening]);
    expect(transport.events.slice(-4)).toEqual([
      'close:1:start',
      'close:1:end',
      'open:2:start',
      'open:2:end',
    ]);
  });

  it('suppresses errors emitted by an opening host after its lifecycle is retired', async () => {
    const config = createTcpInterfaceDraft('tcp-stale-open');
    const commands: Array<{ type: string; state?: string }> = [];
    const host = new PlatformInterfaceHost((command) => { commands.push(command); }, () => undefined);

    transport.failOpeningConnectionWhenClosed();
    const opening = host.open(config);
    await vi.waitFor(() => expect(transport.events).toEqual(['open:1:start']));
    await host.close(config.id);
    await opening;

    expect(commands).not.toContainEqual(expect.objectContaining({
      type: 'platformInterfaceState',
      state: 'error',
    }));
  });

  it('reports a stale TCP connection after a platform resume', async () => {
    const config = createTcpInterfaceDraft('tcp-resume');
    const commands: Array<{ type: string; state?: string }> = [];
    const host = new PlatformInterfaceHost((command) => { commands.push(command); }, () => undefined);

    const opening = host.open(config);
    await vi.waitFor(() => expect(transport.events).toEqual(['open:1:start']));
    transport.releaseFirst();
    await opening;
    commands.length = 0;
    transport.connected = false;

    await host.resume();

    expect(commands).toContainEqual(expect.objectContaining({
      type: 'platformInterfaceState',
      state: 'offline',
    }));
  });

  it('does not probe a TCP interface while its native connection is opening', async () => {
    const config = createTcpInterfaceDraft('tcp-opening-resume');
    const host = new PlatformInterfaceHost(() => undefined, () => undefined);

    const opening = host.open(config);
    await vi.waitFor(() => expect(transport.events).toEqual(['open:1:start']));

    await host.resume();
    expect(transport.healthChecks).toBe(0);

    transport.releaseFirst();
    await opening;
    await host.resume();
    expect(transport.healthChecks).toBe(1);
  });

  it('deduplicates overlapping TCP resume health checks', async () => {
    const config = createTcpInterfaceDraft('tcp-overlapping-resume');
    const host = new PlatformInterfaceHost(() => undefined, () => undefined);
    const opening = host.open(config);
    await vi.waitFor(() => expect(transport.events).toEqual(['open:1:start']));
    transport.releaseFirst();
    await opening;

    transport.blockHealthCheck();
    const firstResume = host.resume();
    await vi.waitFor(() => expect(transport.healthChecks).toBe(1));
    const secondResume = host.resume();
    await Promise.resolve();
    expect(transport.healthChecks).toBe(1);

    transport.releaseHealthCheck();
    await Promise.all([firstResume, secondResume]);
  });

  it('passes UDP datagrams without TCP HDLC framing', async () => {
    const config = createUdpInterfaceDraft('udp-electron');
    const commands: Array<{ type: string; data?: Uint8Array; state?: string }> = [];
    const host = new PlatformInterfaceHost((command) => { commands.push(command); }, () => undefined);

    await host.open(config);
    expect(commands).toContainEqual(expect.objectContaining({
      type: 'platformInterfaceState',
      state: 'online',
    }));

    const received = Uint8Array.of(1, 2, 3, 4);
    datagram.onData?.(received);
    expect(commands).toContainEqual(expect.objectContaining({
      type: 'platformInterfaceData',
      data: received,
    }));

    const outbound = Uint8Array.of(9, 8, 7);
    await host.write(config.id, outbound);
    expect(datagram.sent).toEqual([outbound]);
  });

  it('preserves packet order while a native interface write is in flight', async () => {
    const config = createTcpInterfaceDraft('tcp-ios');
    const host = new PlatformInterfaceHost(() => undefined, () => undefined);
    const opening = host.open(config);
    await vi.waitFor(() => expect(transport.events).toEqual(['open:1:start']));
    transport.releaseFirst();
    await opening;

    transport.blockWrite();
    const identify = host.write(config.id, Uint8Array.of(1));
    await vi.waitFor(() => expect(transport.events).toContain('write:1:start'));
    const request = host.write(config.id, Uint8Array.of(2));
    await Promise.resolve();
    expect(transport.events.filter((event) => event === 'write:1:start')).toHaveLength(1);

    transport.releaseWrite();
    await Promise.all([identify, request]);
    expect(transport.events.slice(-4)).toEqual([
      'write:1:start',
      'write:1:end',
      'write:1:start',
      'write:1:end',
    ]);
  });
});
