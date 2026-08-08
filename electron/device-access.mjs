import { randomUUID } from 'node:crypto';
import { systemPreferences } from 'electron';
import {
  permissionCheckAllowed,
  permissionRequestDecision,
  requestedMediaTypes,
} from './permission-policy.mjs';

const REQUEST_CHANNEL = 'retivum:device:selection-request';
const RESPONSE_CHANNEL = 'retivum:device:selection-response';
const PAIRING_REQUEST_CHANNEL = 'retivum:device:pairing-request';
const PAIRING_RESPONSE_CHANNEL = 'retivum:device:pairing-response';
const PAIRING_KINDS = new Set(['confirm', 'confirmPin', 'providePin']);

function isTrustedWebContents(window, webContents) {
  return webContents?.id === window.webContents.id;
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

/**
 * Installs Electron-specific device selection and renderer permissions.
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

  function requestBluetoothPairing(details) {
    if (!PAIRING_KINDS.has(details?.pairingKind)) return Promise.resolve({ confirmed: false });
    const requestId = randomUUID();
    return new Promise((resolve) => {
      pendingPairing.set(requestId, { resolve, pairingKind: details.pairingKind });
      window.webContents.send(PAIRING_REQUEST_CHANNEL, {
        requestId,
        deviceId: typeof details.deviceId === 'string' ? details.deviceId : '',
        pairingKind: details.pairingKind,
        ...(typeof details.pin === 'string' ? { pin: details.pin } : {}),
      });
    });
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
      pairing.resolve({ confirmed: false });
      return;
    }
    pairing.resolve(pin ? { confirmed, pin } : { confirmed });
  });

  if (process.platform !== 'darwin' && typeof session.setBluetoothPairingHandler === 'function') {
    session.setBluetoothPairingHandler((details, callback) => {
      if ((details.frame && details.frame !== window.webContents.mainFrame)
        || !PAIRING_KINDS.has(details.pairingKind)) {
        callback({ confirmed: false });
        return;
      }
      void requestBluetoothPairing(details).then(callback, () => callback({ confirmed: false }));
    });
  }

  window.webContents.on('select-bluetooth-device', selectBluetooth);
  session.on('select-serial-port', selectSerial);
  session.setDevicePermissionHandler((details) => details.deviceType === 'serial' && details.origin.startsWith('file://'));
  session.setPermissionCheckHandler((webContents, permission, _origin, details) => (
    permissionCheckAllowed(
      isTrustedWebContents(window, webContents),
      permission,
      details,
    )
  ));
  session.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const decision = permissionRequestDecision(
      isTrustedWebContents(window, webContents),
      permission,
      details,
    );
    if (decision === 'allow') {
      callback(true);
      return;
    }
    if (decision === 'deny') {
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

  const dispose = () => {
    if (bluetoothTimeout) clearTimeout(bluetoothTimeout);
    bluetoothCallback?.('');
    bluetoothSelectionPending = false;
    for (const selection of pending.values()) selection.callback('');
    pending.clear();
    for (const pairing of pendingPairing.values()) pairing.resolve({ confirmed: false });
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
  return { dispose, requestBluetoothPairing };
}
