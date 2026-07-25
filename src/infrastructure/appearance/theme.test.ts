import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setNativeBackdropColor } from './native-backdrop';
import { applyThemePreference, setOverlayBackdropVisible } from './theme';

vi.mock('./native-backdrop', () => ({
  setNativeBackdropColor: vi.fn(),
}));

describe('applyThemePreference', () => {
  beforeEach(() => {
    document.head.innerHTML = '<meta name="theme-color" content="#000000">';
    vi.mocked(setNativeBackdropColor).mockClear();
  });

  afterEach(() => {
    document.documentElement.dataset.theme = 'system';
    vi.unstubAllGlobals();
  });

  it.each([
    ['dark', '#0b0f0c'],
    ['light', '#f3f6f3'],
  ] as const)('applies the %s theme and its native backdrop', (theme, background) => {
    applyThemePreference(theme);

    expect(document.documentElement.dataset.theme).toBe(theme);
    expect(document.querySelector('meta[name="theme-color"]')).toHaveAttribute('content', background);
    expect(setNativeBackdropColor).toHaveBeenLastCalledWith(background);
  });

  it('tracks system appearance changes while the system theme is selected', () => {
    let lightAppearance = true;
    let changeListener: (() => void) | undefined;
    vi.stubGlobal('matchMedia', vi.fn(() => ({
      get matches() { return lightAppearance; },
      media: '(prefers-color-scheme: light)',
      addEventListener: (_event: string, listener: () => void) => { changeListener = listener; },
      removeEventListener: vi.fn(),
    })));

    applyThemePreference('system');
    expect(setNativeBackdropColor).toHaveBeenLastCalledWith('#f3f6f3');

    lightAppearance = false;
    changeListener?.();
    expect(setNativeBackdropColor).toHaveBeenLastCalledWith('#0b0f0c');
  });

  it.each([
    ['dark', '#050906', '#0b0f0c'],
    ['light', '#464a47', '#f3f6f3'],
  ] as const)('dims and restores the %s native backdrop while an overlay is visible', (
    theme,
    overlayBackground,
    themeBackground,
  ) => {
    applyThemePreference(theme);

    setOverlayBackdropVisible(true);
    expect(document.querySelector('meta[name="theme-color"]')).toHaveAttribute('content', overlayBackground);
    expect(setNativeBackdropColor).toHaveBeenLastCalledWith(overlayBackground);

    setOverlayBackdropVisible(false);
    expect(document.querySelector('meta[name="theme-color"]')).toHaveAttribute('content', themeBackground);
    expect(setNativeBackdropColor).toHaveBeenLastCalledWith(themeBackground);
  });

  it('keeps the native backdrop dimmed until the last overlapping overlay closes', () => {
    applyThemePreference('light');

    setOverlayBackdropVisible(true);
    setOverlayBackdropVisible(true);
    setOverlayBackdropVisible(false);
    expect(setNativeBackdropColor).toHaveBeenLastCalledWith('#464a47');

    setOverlayBackdropVisible(false);
    expect(setNativeBackdropColor).toHaveBeenLastCalledWith('#f3f6f3');
  });
});
