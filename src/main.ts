import './styles/app.css';
import { Capacitor } from '@capacitor/core';
import { mount } from 'svelte';
import App from './App.svelte';
import { defaultAppPreferences } from './domain/settings';
import { applyThemePreference } from './infrastructure/appearance/theme';
import { BrowserSettingsRepository } from './infrastructure/database/settings-repository';
import { keepMobileDisplayAwakeWhileForeground } from './infrastructure/platform/display-wake-lock';
import { configureNativeViewport } from './infrastructure/platform/native-viewport';
import { lockNativeScreenOrientation } from './infrastructure/platform/screen-orientation';

const native = Capacitor.isNativePlatform();
const mobile = native && ['android', 'ios'].includes(Capacitor.getPlatform());
configureNativeViewport(native);
await lockNativeScreenOrientation(native);
await keepMobileDisplayAwakeWhileForeground(mobile);

async function applyInitialTheme(): Promise<void> {
  try {
    const snapshot = await new BrowserSettingsRepository().load();
    applyThemePreference(snapshot.preferences.theme);
  } catch {
    applyThemePreference(defaultAppPreferences.theme);
  }
}

const target = document.getElementById('app');

if (!target) {
  throw new Error('APP_MOUNT_TARGET_MISSING');
}

await applyInitialTheme();
const app = mount(App, { target });

export default app;
