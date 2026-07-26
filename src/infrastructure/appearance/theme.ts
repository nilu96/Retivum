import type { ThemePreference } from '../../domain/settings';
import { setNativeBackdropColor } from './native-backdrop';

const themeBackgrounds = {
  dark: '#0b0f0c',
  light: '#f3f6f3',
} as const;

export type OverlayBackdropKind = 'modal' | 'imageViewer';

const overlayBackgrounds: Record<
  OverlayBackdropKind,
  Record<keyof typeof themeBackgrounds, string>
> = {
  modal: {
    dark: '#050906',
    light: '#464a47',
  },
  imageViewer: {
    dark: '#040705',
    light: '#202321',
  },
} as const;

let activeTheme: ThemePreference = 'system';
let systemThemeQuery: MediaQueryList | undefined;
const overlayCounts: Record<OverlayBackdropKind, number> = {
  modal: 0,
  imageViewer: 0,
};

function resolvedTheme(theme: ThemePreference): keyof typeof themeBackgrounds {
  if (theme !== 'system') return theme;
  return systemThemeQuery?.matches ? 'light' : 'dark';
}

function applyResolvedThemeBackground(): void {
  const theme = resolvedTheme(activeTheme);
  const background = overlayCounts.imageViewer > 0
    ? overlayBackgrounds.imageViewer[theme]
    : overlayCounts.modal > 0
      ? overlayBackgrounds.modal[theme]
      : themeBackgrounds[theme];
  document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
    ?.setAttribute('content', background);
  setNativeBackdropColor(background);
}

function observeSystemTheme(): void {
  if (systemThemeQuery || typeof window.matchMedia !== 'function') return;
  systemThemeQuery = window.matchMedia('(prefers-color-scheme: light)');
  systemThemeQuery.addEventListener('change', () => {
    if (activeTheme === 'system') applyResolvedThemeBackground();
  });
}

export function applyThemePreference(theme: ThemePreference): void {
  activeTheme = theme;
  observeSystemTheme();
  document.documentElement.dataset.theme = theme;
  applyResolvedThemeBackground();
}

export function setOverlayBackdropVisible(
  visible: boolean,
  kind: OverlayBackdropKind = 'modal',
): void {
  overlayCounts[kind] = Math.max(0, overlayCounts[kind] + (visible ? 1 : -1));
  applyResolvedThemeBackground();
}
