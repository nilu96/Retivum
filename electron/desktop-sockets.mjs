import net from 'node:net';

const OPEN_CHANNEL = 'retivum:tcp:open';
const WRITE_CHANNEL = 'retivum:tcp:write';
const CLOSE_CHANNEL = 'retivum:tcp:close';
const EVENT_CHANNEL = 'retivum:tcp:event';

/**
 * Register this from the Electron main process after app.whenReady(). The
 * caller owns the BrowserWindow and supplies the exact trusted renderer check.
 */
export function registerDesktopSockets(ipcMain, isTrustedSender) {
  const sockets = new Map();
  let resourceOwner;

  const ownerDestroyed = () => {
    const ownerId = resourceOwner?.id;
    resourceOwner = undefined;
    for (const [id, entry] of sockets) {
      if (entry.ownerId === ownerId) close(id);
    }
  };

  function rememberOwner(owner) {
    if (resourceOwner === owner) return;
    if (resourceOwner && !resourceOwner.isDestroyed()) {
      resourceOwner.removeListener('destroyed', ownerDestroyed);
    }
    for (const id of Array.from(sockets.keys())) close(id);
    resourceOwner = owner;
    resourceOwner.once('destroyed', ownerDestroyed);
  }

  function assertTrusted(event) {
    if (!isTrustedSender(event.senderFrame)) throw new Error('UNTRUSTED_IPC_SENDER');
  }

  function close(id) {
    const entry = sockets.get(id);
    sockets.delete(id);
    entry?.socket.destroy();
  }

  ipcMain.handle(OPEN_CHANNEL, async (event, options) => {
    assertTrusted(event);
    const { id, host, port } = validateEndpoint(options);
    close(id);
    rememberOwner(event.sender);
    await new Promise((resolve, reject) => {
      const socket = net.createConnection({ host, port });
      const owner = event.sender;
      const entry = { socket, ownerId: owner.id };
      let connected = false;
      sockets.set(id, entry);
      socket.setNoDelay(true);
      socket.once('connect', () => {
        if (sockets.get(id)?.socket !== socket) {
          socket.destroy();
          reject(new Error('TCP_SOCKET_REPLACED'));
          return;
        }
        connected = true;
        resolve();
      });
      socket.on('data', (data) => {
        if (sockets.get(id)?.socket === socket && !owner.isDestroyed()) {
          owner.send(EVENT_CHANNEL, { id, type: 'data', data: Array.from(data) });
        }
      });
      socket.on('close', () => {
        if (sockets.get(id)?.socket !== socket) {
          if (!connected) reject(new Error('TCP_SOCKET_REPLACED'));
          return;
        }
        sockets.delete(id);
        if (!connected) {
          reject(new Error('TCP_SOCKET_CLOSED'));
          return;
        }
        if (!owner.isDestroyed()) owner.send(EVENT_CHANNEL, { id, type: 'closed' });
      });
      socket.on('error', (error) => {
        if (sockets.get(id)?.socket !== socket) return;
        close(id);
        if (!connected) {
          reject(error);
          return;
        }
        if (!owner.isDestroyed()) owner.send(EVENT_CHANNEL, { id, type: 'error', errorCode: 'TCP_SOCKET_ERROR' });
      });
    });
  });

  ipcMain.handle(WRITE_CHANNEL, async (event, options) => {
    assertTrusted(event);
    const id = validId(options?.id);
    const entry = sockets.get(id);
    if (!entry || entry.ownerId !== event.sender.id) return { ok: false, errorCode: 'TCP_SOCKET_NOT_OPEN' };
    if (!Array.isArray(options?.data) || options.data.length > 2 * 1024 * 1024 || options.data.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 255)) {
      throw new Error('TCP_SOCKET_DATA_INVALID');
    }
    const error = await new Promise((resolve) => entry.socket.write(Buffer.from(options.data), resolve));
    return error ? { ok: false, errorCode: 'TCP_SOCKET_WRITE_FAILED' } : { ok: true };
  });

  ipcMain.handle(CLOSE_CHANNEL, async (event, options) => {
    assertTrusted(event);
    const id = validId(options?.id);
    const entry = sockets.get(id);
    if (entry?.ownerId === event.sender.id) close(id);
  });

  return () => {
    ipcMain.removeHandler(OPEN_CHANNEL);
    ipcMain.removeHandler(WRITE_CHANNEL);
    ipcMain.removeHandler(CLOSE_CHANNEL);
    if (resourceOwner && !resourceOwner.isDestroyed()) {
      resourceOwner.removeListener('destroyed', ownerDestroyed);
    }
    resourceOwner = undefined;
    for (const id of Array.from(sockets.keys())) close(id);
  };
}

function validateEndpoint(value) {
  const id = validId(value?.id);
  if (typeof value?.host !== 'string' || !value.host.trim() || value.host.length > 253) throw new Error('TCP_HOST_INVALID');
  if (!Number.isInteger(value?.port) || value.port < 1 || value.port > 65535) throw new Error('TCP_PORT_INVALID');
  return { id, host: value.host.trim(), port: value.port };
}

function validId(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9-]{1,128}$/.test(value)) throw new Error('TCP_INTERFACE_ID_INVALID');
  return value;
}
