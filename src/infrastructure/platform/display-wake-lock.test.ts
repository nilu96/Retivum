import { beforeEach, describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({
  appStateListener: undefined as ((state: { isActive: boolean }) => void) | undefined,
  getState: vi.fn(async () => ({ isActive: true })),
  keepAwake: vi.fn(async () => undefined),
  allowSleep: vi.fn(async () => undefined),
  remove: vi.fn(async () => undefined),
}));

vi.mock('@capacitor/app', () => ({
  App: {
    getState: native.getState,
    addListener: vi.fn(async (_event: string, listener: (state: { isActive: boolean }) => void) => {
      native.appStateListener = listener;
      return { remove: native.remove };
    }),
  },
}));

vi.mock('@capacitor-community/keep-awake', () => ({
  KeepAwake: {
    keepAwake: native.keepAwake,
    allowSleep: native.allowSleep,
  },
}));

import { keepMobileDisplayAwakeWhileForeground } from './display-wake-lock';

describe('mobile display wake lock', () => {
  beforeEach(() => {
    native.appStateListener = undefined;
    native.getState.mockClear();
    native.keepAwake.mockClear();
    native.allowSleep.mockClear();
    native.remove.mockClear();
  });

  it('does nothing outside the mobile native shells', async () => {
    const dispose = await keepMobileDisplayAwakeWhileForeground(false);
    expect(native.getState).not.toHaveBeenCalled();
    expect(native.keepAwake).not.toHaveBeenCalled();
    await dispose();
    expect(native.allowSleep).not.toHaveBeenCalled();
  });

  it('keeps the display awake only while the mobile app is active', async () => {
    const dispose = await keepMobileDisplayAwakeWhileForeground(true);
    expect(native.keepAwake).toHaveBeenCalledOnce();

    native.appStateListener?.({ isActive: false });
    await vi.waitFor(() => expect(native.allowSleep).toHaveBeenCalledOnce());

    native.appStateListener?.({ isActive: true });
    await vi.waitFor(() => expect(native.keepAwake).toHaveBeenCalledTimes(2));

    await dispose();
    expect(native.remove).toHaveBeenCalledOnce();
    expect(native.allowSleep).toHaveBeenCalledTimes(2);
  });
});
