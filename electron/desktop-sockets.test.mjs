import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';

const { createConnection } = vi.hoisted(() => ({ createConnection: vi.fn() }));
vi.mock('node:net', () => ({ default: { createConnection } }));

import { registerDesktopSockets } from './desktop-sockets.mjs';

class FakeSocket extends EventEmitter {
  setNoDelay() {}
  destroy() {}
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

describe('Electron TCP socket ownership', () => {
  it('uses one WebContents destruction listener across repeated remote reconnects', async () => {
    const sockets = [];
    createConnection.mockImplementation(() => {
      const socket = new FakeSocket();
      sockets.push(socket);
      queueMicrotask(() => socket.emit('connect'));
      return socket;
    });
    const owner = Object.assign(new EventEmitter(), {
      id: 7,
      isDestroyed: vi.fn(() => false),
      send: vi.fn(),
    });
    const { ipcMain, handlers } = createIpcMain();
    const dispose = registerDesktopSockets(ipcMain, () => true);
    const open = handlers.get('retivum:tcp:open');

    for (let index = 0; index < 12; index += 1) {
      await open({ sender: owner, senderFrame: {} }, { id: `socket-${index}`, host: '127.0.0.1', port: 4242 });
      sockets[index].emit('close');
    }

    expect(owner.listenerCount('destroyed')).toBe(1);
    dispose();
    expect(owner.listenerCount('destroyed')).toBe(0);
  });
});
