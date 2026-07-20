import { get } from 'svelte/store';
import { describe, expect, it } from 'vitest';
import { t } from './index';

describe('localization', () => {
  it('formats typed messages with parameters', () => {
    expect(get(t)('chat.search.placeholder', { scope: 'contacts' })).toBe('Search contacts');
  });

  it('leaves a missing parameter visible during development', () => {
    expect(get(t)('chat.search.placeholder')).toBe('Search {scope}');
  });
});
