export const APP_RESUME_CHANNEL = 'retivum:app:resume';

export function installDesktopAppLifecycle(window, powerMonitor) {
  const resumed = () => {
    if (!window.isDestroyed()) window.webContents.send(APP_RESUME_CHANNEL);
  };
  powerMonitor.on('resume', resumed);
  return () => powerMonitor.removeListener('resume', resumed);
}
