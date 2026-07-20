import { writable } from 'svelte/store';
import type { MessageKey, MessageParameters } from '../../i18n';

export type ToastKind = 'success' | 'error' | 'info';

export interface ToastNotification {
  id: number;
  kind: ToastKind;
  messageKey: MessageKey;
  parameters?: MessageParameters;
}

const maximumVisibleToasts = 4;
const defaultDuration: Record<ToastKind, number> = {
  success: 4_000,
  info: 4_500,
  error: 6_000,
};

let nextId = 1;
const timers = new Map<number, ReturnType<typeof setTimeout>>();
export const toasts = writable<ToastNotification[]>([]);

export function dismissToast(id: number): void {
  const timer = timers.get(id);
  if (timer) clearTimeout(timer);
  timers.delete(id);
  toasts.update((items) => items.filter((item) => item.id !== id));
}

export function clearToasts(): void {
  for (const timer of timers.values()) clearTimeout(timer);
  timers.clear();
  toasts.set([]);
}

function showToast(
  kind: ToastKind,
  messageKey: MessageKey,
  parameters?: MessageParameters,
  durationMs = defaultDuration[kind],
): number {
  const id = nextId++;
  toasts.update((items) => {
    const next = [...items, { id, kind, messageKey, parameters }];
    const removed = next.slice(0, Math.max(0, next.length - maximumVisibleToasts));
    for (const item of removed) {
      const timer = timers.get(item.id);
      if (timer) clearTimeout(timer);
      timers.delete(item.id);
    }
    return next.slice(-maximumVisibleToasts);
  });
  timers.set(id, setTimeout(() => dismissToast(id), durationMs));
  return id;
}

export const toast = {
  success: (messageKey: MessageKey, parameters?: MessageParameters, durationMs?: number) => (
    showToast('success', messageKey, parameters, durationMs)
  ),
  error: (messageKey: MessageKey, parameters?: MessageParameters, durationMs?: number) => (
    showToast('error', messageKey, parameters, durationMs)
  ),
  info: (messageKey: MessageKey, parameters?: MessageParameters, durationMs?: number) => (
    showToast('info', messageKey, parameters, durationMs)
  ),
};
