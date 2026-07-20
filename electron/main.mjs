import { app, BrowserWindow, ipcMain, shell } from 'electron';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installDeviceAccess } from './device-access.mjs';
import { registerDesktopSockets } from './desktop-sockets.mjs';
import { registerDesktopDatagrams } from './desktop-datagrams.mjs';

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const rendererEntry = resolve(projectRoot, 'dist', 'index.html');
const preloadEntry = join(projectRoot, 'electron', 'preload.cjs');
const appIconName = process.platform === 'darwin'
  ? 'icon-macos.png'
  : process.platform === 'win32'
    ? 'icon.ico'
    : 'icon.png';
const appIcon = join(projectRoot, 'electron', 'assets', appIconName);
let mainWindow;
let disposeDesktopIntegration;

app.setName('Retivum');

function isTrustedRendererFrame(frame) {
  if (!frame || frame !== mainWindow?.webContents.mainFrame) return false;
  try {
    return resolve(fileURLToPath(frame.url)) === rendererEntry;
  } catch {
    return false;
  }
}

async function createWindow() {
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 420,
    minHeight: 600,
    show: false,
    backgroundColor: '#101510',
    icon: appIcon,
    webPreferences: {
      preload: preloadEntry,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow = window;

  const disposeSockets = registerDesktopSockets(ipcMain, isTrustedRendererFrame);
  const disposeDatagrams = registerDesktopDatagrams(ipcMain, isTrustedRendererFrame);
  const disposeDevices = installDeviceAccess(window, ipcMain);
  disposeDesktopIntegration = () => {
    disposeDevices();
    disposeDatagrams();
    disposeSockets();
  };

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => {
    try {
      if (resolve(fileURLToPath(url)) === rendererEntry) return;
    } catch { /* reject non-file navigation */ }
    event.preventDefault();
  });
  window.on('closed', () => {
    disposeDesktopIntegration?.();
    disposeDesktopIntegration = undefined;
    mainWindow = undefined;
  });

  await window.loadFile(rendererEntry);
  if (!window.isDestroyed()) {
    window.center();
    window.show();
    window.focus();
    app.focus({ steal: true });
  }
}

void app.whenReady()
  .then(() => {
    if (process.platform === 'darwin') app.dock?.setIcon(appIcon);
    return createWindow();
  })
  .catch((error) => {
    console.error('RETIVUM_ELECTRON_START_FAILED', error);
    app.quit();
  });

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    void createWindow().catch((error) => console.error('RETIVUM_ELECTRON_WINDOW_FAILED', error));
  } else {
    mainWindow?.show();
    mainWindow?.focus();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
