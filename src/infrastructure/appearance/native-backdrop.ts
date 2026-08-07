import {
  Capacitor,
  registerPlugin,
  SystemBars,
  SystemBarsStyle,
} from '@capacitor/core';

interface RetivumAppearancePlugin {
  setBackgroundColor(options: { color: string }): Promise<void>;
}

const RetivumAppearance = registerPlugin<RetivumAppearancePlugin>('RetivumAppearance');
let nativeAppearanceUpdate = Promise.resolve();

function systemBarsStyleForBackground(color: string): SystemBarsStyle {
  const red = Number.parseInt(color.slice(1, 3), 16) / 255;
  const green = Number.parseInt(color.slice(3, 5), 16) / 255;
  const blue = Number.parseInt(color.slice(5, 7), 16) / 255;
  const linear = [red, green, blue].map((channel) => (
    channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4
  ));
  const luminance = (0.2126 * linear[0]) + (0.7152 * linear[1]) + (0.0722 * linear[2]);
  return luminance > 0.45 ? SystemBarsStyle.Light : SystemBarsStyle.Dark;
}

async function applyNativeAppearance(color: string): Promise<void> {
  try {
    await SystemBars.setStyle({ style: systemBarsStyleForBackground(color) });
  } catch {
    // Keep the native backdrop update independent from system-bar support.
  }
  await RetivumAppearance.setBackgroundColor({ color }).catch(() => undefined);
}

export function setNativeBackdropColor(color: string): void {
  if (!Capacitor.isNativePlatform()
    || (Capacitor.getPlatform() !== 'ios' && Capacitor.getPlatform() !== 'android')) return;
  nativeAppearanceUpdate = nativeAppearanceUpdate.then(() => applyNativeAppearance(color));
}
