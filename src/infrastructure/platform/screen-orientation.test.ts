import { beforeEach, describe, expect, it, vi } from 'vitest';

const lock = vi.hoisted(() => vi.fn());

vi.mock('@capacitor/screen-orientation', () => ({
  ScreenOrientation: { lock },
}));

import { lockNativeScreenOrientation } from './screen-orientation';

describe('native screen orientation', () => {
  beforeEach(() => lock.mockReset());

  it('locks native builds to primary portrait', async () => {
    lock.mockResolvedValue(undefined);
    await lockNativeScreenOrientation(true);
    expect(lock).toHaveBeenCalledWith({ orientation: 'portrait-primary' });
  });

  it('does not invoke a native plugin in a browser', async () => {
    await lockNativeScreenOrientation(false);
    expect(lock).not.toHaveBeenCalled();
  });
});
