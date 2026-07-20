import type { ThemePreference } from '../../domain/settings';

export function applyThemePreference(theme: ThemePreference): void {
  document.documentElement.dataset.theme = theme;
}
