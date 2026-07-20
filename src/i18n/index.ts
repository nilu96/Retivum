import { derived, writable } from 'svelte/store';
import english from './locales/en.json';

export type MessageKey = keyof typeof english;
export type MessageParameters = Record<string, string | number>;
export type Locale = 'en';
export type Translate = (key: MessageKey, parameters?: MessageParameters) => string;

const catalogs = {
  en: english,
} as const;

export const locale = writable<Locale>('en');

function formatMessage(template: string, parameters: MessageParameters = {}): string {
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (placeholder, name: string) => {
    const value = parameters[name];
    return value === undefined ? placeholder : String(value);
  });
}

export const t = derived(locale, ($locale): Translate => {
  const catalog = catalogs[$locale];

  return (key: MessageKey, parameters?: MessageParameters) => formatMessage(catalog[key], parameters);
});

export function setDocumentLocale(nextLocale: Locale): void {
  document.documentElement.lang = nextLocale;
  document.documentElement.dir = 'ltr';
  locale.set(nextLocale);
}

export function createDateFormatter(nextLocale: Locale, options?: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat(nextLocale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    ...options,
  });
}
