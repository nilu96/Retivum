import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createUdpInterfaceDraft } from '../../domain/settings';

const nativeUdp = vi.hoisted(() => ({
  receiveBatch: undefined as ((event: {
    packets?: Array<{ socketId: number; buffer?: string }>;
  }) => void) | undefined,
  sendBatches: [] as Array<{ socketId: number; address: string; port: number; buffers: string[] }>,
  reset() {
    this.receiveBatch = undefined;
    this.sendBatches = [];
  },
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    getPlatform: () => 'ios',
    isNativePlatform: () => true,
  },
}));

vi.mock('capacitor-udp-socket', () => ({
  UdpSocket: {
    create: vi.fn(async () => ({ socketId: 7, ipv4: '', ipv6: '' })),
    bind: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
    setBroadcast: vi.fn(async () => undefined),
    send: vi.fn(async () => ({ bytesSent: 0 })),
    sendBatch: vi.fn(async (options: {
      socketId: number;
      address: string;
      port: number;
      buffers: string[];
    }) => {
      nativeUdp.sendBatches.push(options);
      return {
        packetsSent: options.buffers.length,
        bytesSent: options.buffers.reduce((total, value) => total + atob(value).length, 0),
      };
    }),
    addListener: vi.fn(async (eventName: string, listener: (event: {
      packets?: Array<{ socketId: number; buffer?: string }>;
    }) => void) => {
      if (eventName === 'receiveBatch') nativeUdp.receiveBatch = listener;
      return { remove: vi.fn(async () => undefined) };
    }),
  },
}));

import { createUdpDatagramConnection } from './datagram-connections';

describe('Capacitor UDP batching', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    nativeUdp.reset();
    window.retivumDesktopUdpSockets = undefined;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('preserves raw datagram boundaries in batched sends and receives', async () => {
    const config = createUdpInterfaceDraft('udp-ios');
    const connection = createUdpDatagramConnection(config);
    const received: Uint8Array[] = [];
    await connection.open((data) => received.push(data), () => undefined);

    const sends = [
      connection.send(Uint8Array.of(1, 2)),
      connection.send(Uint8Array.of(3)),
      connection.send(Uint8Array.of(4, 5, 6)),
    ];
    await vi.advanceTimersByTimeAsync(1);
    await Promise.all(sends);

    expect(nativeUdp.sendBatches).toHaveLength(1);
    expect(nativeUdp.sendBatches[0]?.buffers.map(decode)).toEqual([
      [1, 2],
      [3],
      [4, 5, 6],
    ]);

    nativeUdp.receiveBatch?.({
      packets: [
        { socketId: 7, buffer: encode([9, 8]) },
        { socketId: 99, buffer: encode([0]) },
        { socketId: 7, buffer: encode([7]) },
      ],
    });
    expect(received.map((data) => Array.from(data))).toEqual([[9, 8], [7]]);

    await connection.close();
  });
});

function encode(bytes: number[]): string {
  return btoa(String.fromCharCode(...bytes));
}

function decode(value: string): number[] {
  return Array.from(atob(value), (character) => character.charCodeAt(0));
}
