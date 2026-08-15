import dgram from 'node:dgram';

const OPEN_CHANNEL = 'retivum:udp:open';
const SEND_CHANNEL = 'retivum:udp:send';
const CLOSE_CHANNEL = 'retivum:udp:close';
const EVENT_CHANNEL = 'retivum:udp:event';

export function registerDesktopDatagrams(ipcMain, isTrustedSender) {
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
    if (!entry) return;
    try { entry.socket.close(); } catch { /* already closed */ }
  }

  ipcMain.handle(OPEN_CHANNEL, async (event, options) => {
    assertTrusted(event);
    const endpoint = validateEndpoint(options);
    close(endpoint.id);
    rememberOwner(event.sender);
    await new Promise((resolve, reject) => {
      const type = endpoint.listenHost.includes(':') || endpoint.forwardHost.includes(':') ? 'udp6' : 'udp4';
      const socket = dgram.createSocket({ type, reuseAddr: true });
      const owner = event.sender;
      let opened = false;
      sockets.set(endpoint.id, { socket, ownerId: owner.id, endpoint });
      socket.on('message', (message) => {
        if (!owner.isDestroyed()) owner.send(EVENT_CHANNEL, {
          id: endpoint.id,
          type: 'data',
          data: Array.from(message),
        });
      });
      socket.on('error', (error) => {
        if (!opened) {
          close(endpoint.id);
          reject(error);
          return;
        }
        if (!owner.isDestroyed()) owner.send(EVENT_CHANNEL, {
          id: endpoint.id,
          type: 'error',
          errorCode: 'UDP_SOCKET_ERROR',
        });
        close(endpoint.id);
      });
      socket.once('listening', () => {
        try {
          if (isIpv4Broadcast(endpoint.forwardHost)) socket.setBroadcast(true);
          opened = true;
          resolve();
        } catch (error) {
          close(endpoint.id);
          reject(error);
        }
      });
      socket.bind(endpoint.listenPort, endpoint.listenHost);
    });
  });

  ipcMain.handle(SEND_CHANNEL, async (event, options) => {
    assertTrusted(event);
    const id = validId(options?.id);
    const entry = sockets.get(id);
    if (!entry || entry.ownerId !== event.sender.id) throw new Error('UDP_SOCKET_NOT_OPEN');
    const data = validData(options?.data);
    await new Promise((resolve, reject) => {
      entry.socket.send(data, entry.endpoint.forwardPort, entry.endpoint.forwardHost, (error) => (
        error ? reject(error) : resolve()
      ));
    });
  });

  ipcMain.handle(CLOSE_CHANNEL, async (event, options) => {
    assertTrusted(event);
    const id = validId(options?.id);
    const entry = sockets.get(id);
    if (entry?.ownerId === event.sender.id) close(id);
  });

  return () => {
    ipcMain.removeHandler(OPEN_CHANNEL);
    ipcMain.removeHandler(SEND_CHANNEL);
    ipcMain.removeHandler(CLOSE_CHANNEL);
    if (resourceOwner && !resourceOwner.isDestroyed()) {
      resourceOwner.removeListener('destroyed', ownerDestroyed);
    }
    resourceOwner = undefined;
    for (const id of Array.from(sockets.keys())) close(id);
  };
}

function validateEndpoint(value) {
  return {
    id: validId(value?.id),
    listenHost: validHost(value?.listenHost, 'UDP_LISTEN_HOST_INVALID'),
    listenPort: validPort(value?.listenPort),
    forwardHost: validHost(value?.forwardHost, 'UDP_FORWARD_HOST_INVALID'),
    forwardPort: validPort(value?.forwardPort),
  };
}

function validHost(value, code) {
  if (typeof value !== 'string' || !value.trim() || value.length > 253) throw new Error(code);
  return value.trim();
}

function validPort(value) {
  if (!Number.isInteger(value) || value < 1 || value > 65_535) throw new Error('UDP_PORT_INVALID');
  return value;
}

function validId(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9-]{1,128}$/.test(value)) throw new Error('UDP_INTERFACE_ID_INVALID');
  return value;
}

function validData(value) {
  if (!Array.isArray(value) || value.length > 65_507 || value.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 255)) {
    throw new Error('UDP_SOCKET_DATA_INVALID');
  }
  return Buffer.from(value);
}

function isIpv4Broadcast(host) {
  return host === '255.255.255.255' || /^\d{1,3}(?:\.\d{1,3}){2}\.255$/.test(host);
}
