import type { ThemePreference } from '../../domain/settings';
import { setNativeBackdropColor } from './native-backdrop';

const themeBackgrounds = {
  dark: '#0b0f0c',
  light: '#f3f6f3',
} as const;

let activeTheme: ThemePreference = 'system';
let systemThemeQuery: MediaQueryList | undefined;

function resolvedTheme(theme: ThemePreference): keyof typeof themeBackgrounds {
  if (theme !== 'system') return theme;
  return systemThemeQuery?.matches ? 'light' : 'dark';
}

function applyResolvedThemeBackground(): void {
  const background = themeBackgrounds[resolvedTheme(activeTheme)];
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
