import { Capacitor, registerPlugin } from '@capacitor/core';

interface RetivumAppearancePlugin {
  setBackgroundColor(options: { color: string }): Promise<void>;
}

const RetivumAppearance = registerPlugin<RetivumAppearancePlugin>('RetivumAppearance');

export function setNativeBackdropColor(color: string): void {
  if (!Capacitor.isNativePlatform()
    || (Capacitor.getPlatform() !== 'ios' && Capacitor.getPlatform() !== 'android')) return;
  void RetivumAppearance.setBackgroundColor({ color }).catch(() => undefined);
}
