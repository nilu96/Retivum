import { ScreenOrientation } from '@capacitor/screen-orientation';

/**
 * Native manifests provide the launch-time restriction. This runtime lock
 * reinforces it after Capacitor restores or recreates its bridge view.
 */
export async function lockNativeScreenOrientation(native: boolean): Promise<void> {
  if (!native) return;
  await ScreenOrientation.lock({ orientation: 'portrait-primary' }).catch(() => undefined);
}
