import { afterEach, describe, expect, it } from 'vitest';
import { applyThemePreference } from './theme';

describe('applyThemePreference', () => {
  afterEach(() => {
    document.documentElement.dataset.theme = 'system';
  });

  it.each(['system', 'dark', 'light'] as const)('applies the %s theme to the document', (theme) => {
    applyThemePreference(theme);
    expect(document.documentElement.dataset.theme).toBe(theme);
  });
});
