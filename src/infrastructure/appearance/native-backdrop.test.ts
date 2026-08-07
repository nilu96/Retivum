import { beforeEach, describe, expect, it, vi } from 'vitest';

const capacitorMock = vi.hoisted(() => ({
  isNative: false,
  platform: 'web',
  setBackgroundColor: vi.fn().mockResolvedValue(undefined),
  setSystemBarsStyle: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    getPlatform: () => capacitorMock.platform,
    isNativePlatform: () => capacitorMock.isNative,
  },
  registerPlugin: () => ({
    setBackgroundColor: capacitorMock.setBackgroundColor,
  }),
  SystemBars: {
    setStyle: capacitorMock.setSystemBarsStyle,
  },
  SystemBarsStyle: {
    Dark: 'DARK',
    Light: 'LIGHT',
  },
}));

import { setNativeBackdropColor } from './native-backdrop';

describe('setNativeBackdropColor', () => {
  beforeEach(() => {
    capacitorMock.isNative = false;
    capacitorMock.platform = 'web';
    capacitorMock.setBackgroundColor.mockClear();
    capacitorMock.setSystemBarsStyle.mockClear();
  });

  it('does not invoke the native plugin in a browser', () => {
    setNativeBackdropColor('#0b0f0c');

    expect(capacitorMock.setBackgroundColor).not.toHaveBeenCalled();
    expect(capacitorMock.setSystemBarsStyle).not.toHaveBeenCalled();
  });

  it.each(['ios', 'android'])('uses light system content over the %s dark backdrop', async (platform) => {
    capacitorMock.isNative = true;
    capacitorMock.platform = platform;

    setNativeBackdropColor('#0b0f0c');

    await vi.waitFor(() => {
      expect(capacitorMock.setSystemBarsStyle).toHaveBeenCalledWith({ style: 'DARK' });
      expect(capacitorMock.setBackgroundColor).toHaveBeenCalledWith({ color: '#0b0f0c' });
    });
  });

  it.each(['ios', 'android'])('uses dark system content over the %s light backdrop', async (platform) => {
    capacitorMock.isNative = true;
    capacitorMock.platform = platform;

    setNativeBackdropColor('#f3f6f3');

    await vi.waitFor(() => {
      expect(capacitorMock.setSystemBarsStyle).toHaveBeenCalledWith({ style: 'LIGHT' });
      expect(capacitorMock.setBackgroundColor).toHaveBeenCalledWith({ color: '#f3f6f3' });
    });
  });
});
