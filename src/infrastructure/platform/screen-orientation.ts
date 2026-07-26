import { ScreenOrientation } from '@capacitor/screen-orientation';

/**
 * Native manifests provide the launch-time restriction. iOS relies on its
 * device-specific manifest entries so iPhone can stay portrait-only while
 * iPad rotates. Other native platforms reinforce portrait after Capacitor
 * restores or recreates its bridge view.
 */
export async function lockNativeScreenOrientation(native: boolean, platform: string): Promise<void> {
  if (!native || platform === 'ios') return;
  await ScreenOrientation.lock({ orientation: 'portrait-primary' }).catch(() => undefined);
}
