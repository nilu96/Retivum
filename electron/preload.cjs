const { contextBridge, ipcRenderer } = require('electron');

const EVENT_CHANNEL = 'retivum:tcp:event';
const UDP_EVENT_CHANNEL = 'retivum:udp:event';
const DEVICE_REQUEST_CHANNEL = 'retivum:device:selection-request';
const PAIRING_REQUEST_CHANNEL = 'retivum:device:pairing-request';

contextBridge.exposeInMainWorld('retivumDesktopSockets', Object.freeze({
  open: (options) => ipcRenderer.invoke('retivum:tcp:open', options),
  write: (options) => ipcRenderer.invoke('retivum:tcp:write', options),
  close: (options) => ipcRenderer.invoke('retivum:tcp:close', options),
  onEvent: (listener) => {
    const handler = (_event, value) => listener(value);
    ipcRenderer.on(EVENT_CHANNEL, handler);
    return () => ipcRenderer.removeListener(EVENT_CHANNEL, handler);
  },
}));

contextBridge.exposeInMainWorld('retivumDesktopUdpSockets', Object.freeze({
  open: (options) => ipcRenderer.invoke('retivum:udp:open', options),
  send: (options) => ipcRenderer.invoke('retivum:udp:send', options),
  close: (options) => ipcRenderer.invoke('retivum:udp:close', options),
  onEvent: (listener) => {
    const handler = (_event, value) => listener(value);
    ipcRenderer.on(UDP_EVENT_CHANNEL, handler);
    return () => ipcRenderer.removeListener(UDP_EVENT_CHANNEL, handler);
  },
}));

contextBridge.exposeInMainWorld('retivumDesktopDevices', Object.freeze({
  respond: (response) => ipcRenderer.invoke('retivum:device:selection-response', response),
  respondPairing: (response) => ipcRenderer.invoke('retivum:device:pairing-response', response),
  onSelectionRequest: (listener) => {
    const handler = (_event, value) => listener(value);
    ipcRenderer.on(DEVICE_REQUEST_CHANNEL, handler);
    return () => ipcRenderer.removeListener(DEVICE_REQUEST_CHANNEL, handler);
  },
  onPairingRequest: (listener) => {
    const handler = (_event, value) => listener(value);
    ipcRenderer.on(PAIRING_REQUEST_CHANNEL, handler);
    return () => ipcRenderer.removeListener(PAIRING_REQUEST_CHANNEL, handler);
  },
}));
