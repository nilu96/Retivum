import { beforeEach, describe, expect, it, vi } from 'vitest';

const capacitorMock = vi.hoisted(() => ({
  isNative: false,
  platform: 'web',
  setBackgroundColor: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    getPlatform: () => capacitorMock.platform,
    isNativePlatform: () => capacitorMock.isNative,
  },
  registerPlugin: () => ({
    setBackgroundColor: capacitorMock.setBackgroundColor,
  }),
}));

import { setNativeBackdropColor } from './native-backdrop';

describe('setNativeBackdropColor', () => {
  beforeEach(() => {
    capacitorMock.isNative = false;
    capacitorMock.platform = 'web';
    capacitorMock.setBackgroundColor.mockClear();
  });

  it('does not invoke the native plugin in a browser', () => {
    setNativeBackdropColor('#0b0f0c');

    expect(capacitorMock.setBackgroundColor).not.toHaveBeenCalled();
  });

  it.each(['ios', 'android'])('updates the %s native backdrop', (platform) => {
    capacitorMock.isNative = true;
    capacitorMock.platform = platform;

    setNativeBackdropColor('#f3f6f3');

    expect(capacitorMock.setBackgroundColor).toHaveBeenCalledWith({
      color: '#f3f6f3',
    });
  });
});
