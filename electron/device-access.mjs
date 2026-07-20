import { randomUUID } from 'node:crypto';
import { systemPreferences } from 'electron';

const REQUEST_CHANNEL = 'retivum:device:selection-request';
const RESPONSE_CHANNEL = 'retivum:device:selection-response';
const PAIRING_REQUEST_CHANNEL = 'retivum:device:pairing-request';
const PAIRING_RESPONSE_CHANNEL = 'retivum:device:pairing-response';
const WEB_PERMISSIONS = new Set(['bluetooth', 'serial']);
const PAIRING_KINDS = new Set(['confirm', 'confirmPin', 'providePin']);

function isTrustedWebContents(window, webContents) {
  return webContents?.id === window.webContents.id;
}

function isMediaCheck(permission, details) {
  return permission === 'media'
    && details?.isMainFrame === true
    && (details.mediaType === 'audio' || details.mediaType === 'video');
}

function requestedMediaTypes(permission, details) {
  if (permission !== 'media'
    || details?.isMainFrame !== true
    || !Array.isArray(details.mediaTypes)
    || details.mediaTypes.length === 0
    || !details.mediaTypes.every((mediaType) => mediaType === 'audio' || mediaType === 'video')) {
    return undefined;
  }
  return new Set(details.mediaTypes);
}

async function requestNativeMediaAccess(mediaTypes) {
  if (process.platform !== 'darwin') return true;
  const nativeTypes = [...mediaTypes].map((type) => type === 'video' ? 'camera' : 'microphone');
  for (const type of nativeTypes) {
    const status = systemPreferences.getMediaAccessStatus(type);
    if (status === 'denied' || status === 'restricted') return false;
    if (status !== 'granted' && !await systemPreferences.askForMediaAccess(type)) return false;
  }
  return true;
}

function isMediaRequest(permission, details) {
  return permission === 'media'
    && details?.isMainFrame === true
    && Array.isArray(details.mediaTypes)
    && details.mediaTypes.length > 0
    && details.mediaTypes.every((mediaType) => mediaType === 'audio' || mediaType === 'video');
}

/**
 * Installs the Electron-specific half of Web Bluetooth and Web Serial.
 * Device candidates are shown by the localized Svelte chooser through a
 * narrow IPC exchange; no generic ipcRenderer surface reaches the page.
 */
export function installDeviceAccess(window, ipcMain) {
  const { session } = window.webContents;
  const pending = new Map();
  const pendingPairing = new Map();
  let bluetoothTimeout;
  let bluetoothCallback;
  let bluetoothSelectionPending = false;

  function requestSelection(type, devices, callback) {
    const requestId = randomUUID();
    pending.set(requestId, { callback, deviceIds: new Set(devices.map((device) => device.id)) });
    window.webContents.send(REQUEST_CHANNEL, { requestId, type, devices });
  }

  const selectBluetooth = (event, devices, callback) => {
    event.preventDefault();
    if (bluetoothSelectionPending) return;
    bluetoothCallback = callback;
    if (devices.length > 0) {
      if (bluetoothTimeout) clearTimeout(bluetoothTimeout);
      bluetoothTimeout = undefined;
      bluetoothCallback = undefined;
      bluetoothSelectionPending = true;
      requestSelection(
        'ble',
        devices.map((device) => ({ id: device.deviceId, name: device.deviceName || 'RNode' })),
        (deviceId) => {
          bluetoothSelectionPending = false;
          callback(deviceId);
        },
      );
      return;
    }
    if (!bluetoothTimeout) {
      bluetoothTimeout = setTimeout(() => {
        bluetoothTimeout = undefined;
        bluetoothCallback?.('');
        bluetoothCallback = undefined;
      }, 10_000);
    }
  };

  const selectSerial = (event, ports, webContents, callback) => {
    if (webContents.id !== window.webContents.id) return;
    event.preventDefault();
    if (ports.length === 0) {
      callback('');
      return;
    }
    requestSelection('serial', ports.map((port) => ({
      id: port.portId,
      name: port.displayName || port.portName,
      detail: [port.vendorId, port.productId].filter(Boolean).join(':'),
    })), callback);
  };

  ipcMain.handle(RESPONSE_CHANNEL, (event, response) => {
    if (event.sender.id !== window.webContents.id || typeof response?.requestId !== 'string') return;
    const selection = pending.get(response.requestId);
    if (!selection) return;
    pending.delete(response.requestId);
    const deviceId = typeof response.deviceId === 'string' && selection.deviceIds.has(response.deviceId)
      ? response.deviceId
      : '';
    selection.callback(deviceId);
  });

  ipcMain.handle(PAIRING_RESPONSE_CHANNEL, (event, response) => {
    if (event.sender.id !== window.webContents.id || typeof response?.requestId !== 'string') return;
    const pairing = pendingPairing.get(response.requestId);
    if (!pairing) return;
    pendingPairing.delete(response.requestId);
    const confirmed = response.confirmed === true;
    const pin = typeof response.pin === 'string' ? response.pin.trim().slice(0, 32) : undefined;
    if (pairing.pairingKind === 'providePin' && (!confirmed || !pin)) {
      pairing.callback({ confirmed: false });
      return;
    }
    pairing.callback(pin ? { confirmed, pin } : { confirmed });
  });

  if (process.platform !== 'darwin' && typeof session.setBluetoothPairingHandler === 'function') {
    session.setBluetoothPairingHandler((details, callback) => {
      if ((details.frame && details.frame !== window.webContents.mainFrame)
        || !PAIRING_KINDS.has(details.pairingKind)) {
        callback({ confirmed: false });
        return;
      }
      const requestId = randomUUID();
      pendingPairing.set(requestId, { callback, pairingKind: details.pairingKind });
      window.webContents.send(PAIRING_REQUEST_CHANNEL, {
        requestId,
        deviceId: details.deviceId,
        pairingKind: details.pairingKind,
        ...(typeof details.pin === 'string' ? { pin: details.pin } : {}),
      });
    });
  }

  window.webContents.on('select-bluetooth-device', selectBluetooth);
  session.on('select-serial-port', selectSerial);
  session.setDevicePermissionHandler((details) => details.deviceType === 'serial' && details.origin.startsWith('file://'));
  session.setPermissionCheckHandler((webContents, permission, _origin, details) => (
    isTrustedWebContents(window, webContents)
      && (WEB_PERMISSIONS.has(permission) || isMediaCheck(permission, details))
  ));
  session.setPermissionRequestHandler((webContents, permission, callback, details) => {
    if (!isTrustedWebContents(window, webContents)) {
      callback(false);
      return;
    }
    if (WEB_PERMISSIONS.has(permission)) {
      callback(true);
      return;
    }
    if (!isMediaRequest(permission, details)) {
      callback(false);
      return;
    }
    const mediaTypes = requestedMediaTypes(permission, details);
    if (!mediaTypes) {
      callback(false);
      return;
    }
    void requestNativeMediaAccess(mediaTypes).then(callback, () => callback(false));
  });

  return () => {
    if (bluetoothTimeout) clearTimeout(bluetoothTimeout);
    bluetoothCallback?.('');
    bluetoothSelectionPending = false;
    for (const selection of pending.values()) selection.callback('');
    pending.clear();
    for (const pairing of pendingPairing.values()) pairing.callback({ confirmed: false });
    pendingPairing.clear();
    window.webContents.removeListener('select-bluetooth-device', selectBluetooth);
    session.removeListener('select-serial-port', selectSerial);
    session.setDevicePermissionHandler(null);
    session.setPermissionCheckHandler(null);
    session.setPermissionRequestHandler(null);
    if (process.platform !== 'darwin' && typeof session.setBluetoothPairingHandler === 'function') {
      session.setBluetoothPairingHandler(null);
    }
    ipcMain.removeHandler(RESPONSE_CHANNEL);
    ipcMain.removeHandler(PAIRING_RESPONSE_CHANNEL);
  };
}
