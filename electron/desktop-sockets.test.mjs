import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';

const { createConnection } = vi.hoisted(() => ({ createConnection: vi.fn() }));
vi.mock('node:net', () => ({ default: { createConnection } }));

import { registerDesktopSockets } from './desktop-sockets.mjs';

class FakeSocket extends EventEmitter {
  setNoDelay() {}
  destroy() {}
  write(_data, callback) { callback(); }
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

  it('ignores delayed events from a socket replaced under the same interface ID', async () => {
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

    await open({ sender: owner, senderFrame: {} }, { id: 'shared-id', host: '127.0.0.1', port: 4242 });
    await open({ sender: owner, senderFrame: {} }, { id: 'shared-id', host: '127.0.0.1', port: 4242 });
    sockets[0].emit('close');
    sockets[0].emit('data', Buffer.from([1]));
    sockets[1].emit('data', Buffer.from([2]));

    expect(owner.send).toHaveBeenCalledTimes(1);
    expect(owner.send).toHaveBeenCalledWith('retivum:tcp:event', {
      id: 'shared-id',
      type: 'data',
      data: [2],
    });
    dispose();
  });

  it('returns a stable result when a write races with socket closure', async () => {
    const owner = Object.assign(new EventEmitter(), {
      id: 7,
      isDestroyed: vi.fn(() => false),
      send: vi.fn(),
    });
    const { ipcMain, handlers } = createIpcMain();
    const dispose = registerDesktopSockets(ipcMain, () => true);

    await expect(handlers.get('retivum:tcp:write')(
      { sender: owner, senderFrame: {} },
      { id: 'closed-socket', data: [1, 2, 3] },
    )).resolves.toEqual({ ok: false, errorCode: 'TCP_SOCKET_NOT_OPEN' });
    dispose();
  });
});
