import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTcpInterfaceDraft, createUdpInterfaceDraft } from '../../domain/settings';

const transport = vi.hoisted(() => {
  let releaseFirstOpen: (() => void) | undefined;
  let releaseBlockedWrite: (() => void) | undefined;
  let blockNextWrite = false;
  return {
    events: [] as string[],
    connectionCount: 0,
    reset() {
      this.events = [];
      this.connectionCount = 0;
      releaseFirstOpen = undefined;
      releaseBlockedWrite = undefined;
      blockNextWrite = false;
    },
    releaseFirst() {
      releaseFirstOpen?.();
    },
    blockWrite() {
      blockNextWrite = true;
    },
    releaseWrite() {
      releaseBlockedWrite?.();
    },
    create() {
      const number = ++this.connectionCount;
      return {
        async open() {
          transport.events.push(`open:${number}:start`);
          if (number === 1) await new Promise<void>((resolve) => { releaseFirstOpen = resolve; });
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
        async close() { transport.events.push(`close:${number}`); },
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

  it('serializes a retry close and open behind an in-flight native connection', async () => {
    const config = createTcpInterfaceDraft('tcp-ios');
    const host = new PlatformInterfaceHost(() => undefined, () => undefined);

    const firstOpen = host.open(config);
    await vi.waitFor(() => expect(transport.events).toEqual(['open:1:start']));

    const close = host.close(config.id);
    const retryOpen = host.open(config);
    await Promise.resolve();
    expect(transport.events).toEqual(['open:1:start']);

    transport.releaseFirst();
    await Promise.all([firstOpen, close, retryOpen]);

    expect(transport.events).toEqual([
      'open:1:start',
      'open:1:end',
      'close:1',
      'open:2:start',
      'open:2:end',
    ]);
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
