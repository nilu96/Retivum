import { writable } from 'svelte/store';
import type { MessageKey, MessageParameters } from '../../i18n';

export type ToastKind = 'success' | 'error' | 'info';
export type ToastNotificationKind = ToastKind | 'activity';

export interface ToastNotification {
  id: number;
  kind: ToastNotificationKind;
  messageKey: MessageKey;
  parameters?: MessageParameters;
  oncancel?: () => void;
}

export interface LiveActivityHandle {
  readonly id: number;
  update: (messageKey: MessageKey, parameters?: MessageParameters) => void;
  success: (messageKey: MessageKey, parameters?: MessageParameters, durationMs?: number) => void;
  error: (messageKey: MessageKey, parameters?: MessageParameters, durationMs?: number) => void;
  dismiss: () => void;
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
  toasts.update((items) => trimTransientToasts([...items, { id, kind, messageKey, parameters }]));
  scheduleDismissal(id, durationMs);
  return id;
}

function startLiveActivity(
  messageKey: MessageKey,
  parameters?: MessageParameters,
  oncancel?: () => void,
): LiveActivityHandle {
  const id = nextId++;
  toasts.update((items) => [...items, { id, kind: 'activity', messageKey, parameters, oncancel }]);
  return {
    id,
    update: (nextMessageKey, nextParameters) => updateLiveActivity(id, nextMessageKey, nextParameters),
    success: (nextMessageKey, nextParameters, durationMs = defaultDuration.success) => {
      finishLiveActivity(id, 'success', nextMessageKey, nextParameters, durationMs);
    },
    error: (nextMessageKey, nextParameters, durationMs = defaultDuration.error) => {
      finishLiveActivity(id, 'error', nextMessageKey, nextParameters, durationMs);
    },
    dismiss: () => dismissToast(id),
  };
}

function updateLiveActivity(id: number, messageKey: MessageKey, parameters?: MessageParameters): void {
  toasts.update((items) => items.map((item) => item.id === id && item.kind === 'activity'
    ? { ...item, messageKey, parameters }
    : item));
}

function finishLiveActivity(
  id: number,
  kind: ToastKind,
  messageKey: MessageKey,
  parameters: MessageParameters | undefined,
  durationMs: number,
): void {
  let finished = false;
  toasts.update((items) => trimTransientToasts(items.map((item) => {
    if (item.id !== id || item.kind !== 'activity') return item;
    finished = true;
    return { id, kind, messageKey, parameters };
  })));
  if (finished) scheduleDismissal(id, durationMs);
}

function trimTransientToasts(items: ToastNotification[]): ToastNotification[] {
  const transient = items.filter((item) => item.kind !== 'activity');
  const removed = new Set(transient.slice(0, Math.max(0, transient.length - maximumVisibleToasts)).map((item) => item.id));
  for (const id of removed) {
    const timer = timers.get(id);
    if (timer) clearTimeout(timer);
    timers.delete(id);
  }
  return items.filter((item) => !removed.has(item.id));
}

function scheduleDismissal(id: number, durationMs: number): void {
  const existing = timers.get(id);
  if (existing) clearTimeout(existing);
  timers.set(id, setTimeout(() => dismissToast(id), durationMs));
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

export const liveActivity = {
  start: (messageKey: MessageKey, parameters?: MessageParameters, oncancel?: () => void) => (
    startLiveActivity(messageKey, parameters, oncancel)
  ),
};
