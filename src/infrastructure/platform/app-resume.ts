import { App } from '@capacitor/app';
import type { PluginListenerHandle } from '@capacitor/core';
import { isMobileNativeShell } from './native-viewport';

export type AppResumeListener = () => void;
export type AppResumeListenerDisposer = () => Promise<void>;

/**
 * Projects platform lifecycle signals into one foreground-resume event without
 * exposing Capacitor, Electron, or browser APIs to application features.
 */
export async function listenForAppResume(
  listener: AppResumeListener,
): Promise<AppResumeListenerDisposer> {
  const desktopLifecycle = window.retivumDesktopLifecycle;
  if (desktopLifecycle) {
    const remove = desktopLifecycle.onResume(listener);
    return async () => { remove(); };
  }

  if (isMobileNativeShell()) {
    let wasInactive = false;
    let handle: PluginListenerHandle | undefined;
    handle = await App.addListener('appStateChange', ({ isActive }) => {
      if (!isActive) {
        wasInactive = true;
        return;
      }
      if (!wasInactive) return;
      wasInactive = false;
      listener();
    }).catch(() => undefined);
    return async () => { await handle?.remove().catch(() => undefined); };
  }

  let wasHidden = document.visibilityState === 'hidden';
  const visibilityChanged = (): void => {
    if (document.visibilityState === 'hidden') {
      wasHidden = true;
      return;
    }
    if (!wasHidden) return;
    wasHidden = false;
    listener();
  };
  document.addEventListener('visibilitychange', visibilityChanged);
  return async () => { document.removeEventListener('visibilitychange', visibilityChanged); };
}
