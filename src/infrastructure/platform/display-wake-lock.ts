import { App } from '@capacitor/app';
import type { PluginListenerHandle } from '@capacitor/core';
import { KeepAwake } from '@capacitor-community/keep-awake';

export async function keepMobileDisplayAwakeWhileForeground(
  mobile: boolean,
): Promise<() => Promise<void>> {
  if (!mobile) return async () => undefined;

  let transition = Promise.resolve();
  const applyState = (isActive: boolean): Promise<void> => {
    transition = transition
      .then(() => isActive ? KeepAwake.keepAwake() : KeepAwake.allowSleep())
      .catch(() => undefined);
    return transition;
  };

  let listener: PluginListenerHandle | undefined;
  listener = await App.addListener('appStateChange', ({ isActive }) => {
    void applyState(isActive);
  }).catch(() => undefined);

  const state = await App.getState().catch(() => ({ isActive: true }));
  await applyState(state.isActive);

  return async () => {
    await listener?.remove().catch(() => undefined);
    await applyState(false);
  };
}
