import { beforeEach, describe, expect, it, vi } from 'vitest';

const lock = vi.hoisted(() => vi.fn());

vi.mock('@capacitor/screen-orientation', () => ({
  ScreenOrientation: { lock },
}));

import { lockNativeScreenOrientation } from './screen-orientation';

describe('native screen orientation', () => {
  beforeEach(() => lock.mockReset());

  it('locks non-iOS native builds to primary portrait', async () => {
    lock.mockResolvedValue(undefined);
    await lockNativeScreenOrientation(true, 'android');
    expect(lock).toHaveBeenCalledWith({ orientation: 'portrait-primary' });
  });

  it('relies on device-specific manifest orientations on iOS', async () => {
    await lockNativeScreenOrientation(true, 'ios');
    expect(lock).not.toHaveBeenCalled();
  });

  it('does not invoke a native plugin in a browser', async () => {
    await lockNativeScreenOrientation(false, 'web');
    expect(lock).not.toHaveBeenCalled();
  });
});
