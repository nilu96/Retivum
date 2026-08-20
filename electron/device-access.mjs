import { randomUUID } from 'node:crypto';
import { systemPreferences } from 'electron';
import {
  permissionCheckAllowed,
  permissionRequestDecision,
  requestedMediaTypes,
} from './permission-policy.mjs';
import { enumerateConnectedUsbDevices } from './serial-device-enumeration.mjs';

const REQUEST_CHANNEL = 'retivum:device:selection-request';
const RESPONSE_CHANNEL = 'retivum:device:selection-response';
const SERIAL_DEVICES_CHANNEL = 'retivum:device:serial-devices';
const PAIRING_REQUEST_CHANNEL = 'retivum:device:pairing-request';
const PAIRING_RESPONSE_CHANNEL = 'retivum:device:pairing-response';
const PAIRING_KINDS = new Set(['confirm', 'confirmPin', 'providePin']);

function isTrustedWebContents(expectedWebContents, webContents) {
  return webContents?.id === expectedWebContents.id;
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
  // BrowserWindow.webContents throws once its native window has been
  // destroyed. Keep the EventEmitter reference so late/fallback disposal can
  // still remove listeners without touching that getter during shutdown.
  const rendererWebContents = window.webContents;
  const { session } = rendererWebContents;
  const pending = new Map();
  const pendingPairing = new Map();
  const serialDevices = new Map();
  let bluetoothTimeout;
  let bluetoothCallback;
  let bluetoothSelectionPending = false;

  function rememberSerialDevice(port) {
    if (!port || typeof port.portId !== 'string') return;
    const name = typeof port.displayName === 'string' ? port.displayName.trim() : '';
    serialDevices.set(port.portId, {
      id: port.portId,
      ...(name ? { name } : {}),
      ...(typeof port.vendorId === 'string' ? { vendorId: port.vendorId } : {}),
      ...(typeof port.productId === 'string' ? { productId: port.productId } : {}),
    });
  }

  function requestSelection(type, devices, callback) {
    const requestId = randomUUID();
    pending.set(requestId, { callback, deviceIds: new Set(devices.map((device) => device.id)) });
    rendererWebContents.send(REQUEST_CHANNEL, { requestId, type, devices });
  }

  function requestBluetoothPairing(details) {
    if (!PAIRING_KINDS.has(details?.pairingKind)) return Promise.resolve({ confirmed: false });
    const requestId = randomUUID();
    return new Promise((resolve) => {
      pendingPairing.set(requestId, { resolve, pairingKind: details.pairingKind });
      rendererWebContents.send(PAIRING_REQUEST_CHANNEL, {
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

  const selectSerial = (event, ports, serialWebContents, callback) => {
    if (serialWebContents.id !== rendererWebContents.id) return;
    event.preventDefault();
    for (const port of ports) rememberSerialDevice(port);
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
    if (event.sender.id !== rendererWebContents.id || typeof response?.requestId !== 'string') return;
    const selection = pending.get(response.requestId);
    if (!selection) return;
    pending.delete(response.requestId);
    const deviceId = typeof response.deviceId === 'string' && selection.deviceIds.has(response.deviceId)
      ? response.deviceId
      : '';
    selection.callback(deviceId);
  });

  ipcMain.handle(SERIAL_DEVICES_CHANNEL, async (event) => {
    if (event.sender.id !== rendererWebContents.id) return [];
    const connectedDevices = await enumerateConnectedUsbDevices();
    const merged = connectedDevices.map((device) => ({ ...device }));
    const usedConnectedDevices = new Set();
    for (const device of serialDevices.values()) {
      const vendorId = typeof device.vendorId === 'string' ? device.vendorId.toLowerCase().padStart(4, '0') : '';
      const productId = typeof device.productId === 'string' ? device.productId.toLowerCase().padStart(4, '0') : '';
      const connectedIndex = merged.findIndex((candidate, index) => !usedConnectedDevices.has(index)
        && vendorId
        && productId
        && candidate.vendorId === vendorId
        && candidate.productId === productId);
      if (connectedIndex >= 0) {
        usedConnectedDevices.add(connectedIndex);
        const connectedDevice = merged[connectedIndex];
        merged[connectedIndex] = {
          ...connectedDevice,
          ...device,
          ...(device.name ? { name: device.name } : connectedDevice.name ? { name: connectedDevice.name } : {}),
        };
      } else {
        merged.push({ ...device });
      }
    }
    return merged;
  });

  ipcMain.handle(PAIRING_RESPONSE_CHANNEL, (event, response) => {
    if (event.sender.id !== rendererWebContents.id || typeof response?.requestId !== 'string') return;
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
      if ((details.frame && details.frame !== rendererWebContents.mainFrame)
        || !PAIRING_KINDS.has(details.pairingKind)) {
        callback({ confirmed: false });
        return;
      }
      void requestBluetoothPairing(details).then(callback, () => callback({ confirmed: false }));
    });
  }

  rendererWebContents.on('select-bluetooth-device', selectBluetooth);
  session.on('select-serial-port', selectSerial);
  session.setDevicePermissionHandler((details) => {
    const allowed = details.deviceType === 'serial' && details.origin.startsWith('file://');
    if (allowed) rememberSerialDevice(details.device);
    return allowed;
  });
  session.setPermissionCheckHandler((requestingWebContents, permission, _origin, details) => (
    permissionCheckAllowed(
      isTrustedWebContents(rendererWebContents, requestingWebContents),
      permission,
      details,
    )
  ));
  session.setPermissionRequestHandler((requestingWebContents, permission, callback, details) => {
    const decision = permissionRequestDecision(
      isTrustedWebContents(rendererWebContents, requestingWebContents),
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
    rendererWebContents.removeListener('select-bluetooth-device', selectBluetooth);
    session.removeListener('select-serial-port', selectSerial);
    session.setDevicePermissionHandler(null);
    session.setPermissionCheckHandler(null);
    session.setPermissionRequestHandler(null);
    if (process.platform !== 'darwin' && typeof session.setBluetoothPairingHandler === 'function') {
      session.setBluetoothPairingHandler(null);
    }
    ipcMain.removeHandler(RESPONSE_CHANNEL);
    ipcMain.removeHandler(SERIAL_DEVICES_CHANNEL);
    ipcMain.removeHandler(PAIRING_RESPONSE_CHANNEL);
  };
  return { dispose, requestBluetoothPairing };
}
