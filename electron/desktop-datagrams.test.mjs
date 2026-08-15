import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';

const { createSocket } = vi.hoisted(() => ({ createSocket: vi.fn() }));
vi.mock('node:dgram', () => ({ default: { createSocket } }));

import { registerDesktopDatagrams } from './desktop-datagrams.mjs';

class FakeDatagramSocket extends EventEmitter {
  bind() { queueMicrotask(() => this.emit('listening')); }
  close() {}
  setBroadcast() {}
}

function createIpcMain() {
  const handlers = new Map();
  return {
    handlers,
    ipcMain: {
      handle: vi.fn((channel, handler) => handlers.set(channel, handler)),
      removeHandler: vi.fn((channel) => handlers.delete(channel)),
    },
  };
}

describe('Electron UDP socket ownership', () => {
  it('uses one WebContents destruction listener for all active datagrams', async () => {
    createSocket.mockImplementation(() => new FakeDatagramSocket());
    const owner = Object.assign(new EventEmitter(), {
      id: 7,
      isDestroyed: vi.fn(() => false),
      send: vi.fn(),
    });
    const { ipcMain, handlers } = createIpcMain();
    const dispose = registerDesktopDatagrams(ipcMain, () => true);
    const open = handlers.get('retivum:udp:open');

    for (let index = 0; index < 12; index += 1) {
      await open({ sender: owner, senderFrame: {} }, {
        id: `datagram-${index}`,
        listenHost: '127.0.0.1',
        listenPort: 4_000 + index,
        forwardHost: '127.0.0.1',
        forwardPort: 5_000 + index,
      });
    }

    expect(owner.listenerCount('destroyed')).toBe(1);
    dispose();
    expect(owner.listenerCount('destroyed')).toBe(0);
  });
});
