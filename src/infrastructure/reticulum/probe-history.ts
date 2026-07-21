import { writable } from 'svelte/store';
import type { ProbeResult } from './protocol';

export interface ProbeHistoryEntry extends ProbeResult {
  id: string;
  completedAt: string;
}

export const probeHistory = writable<ProbeHistoryEntry[]>([]);

export function recordProbeResult(result: ProbeResult): void {
  probeHistory.update((entries) => [{
    ...result,
    id: crypto.randomUUID(),
    completedAt: new Date().toISOString(),
  }, ...entries].slice(0, 100));
}

export function clearProbeHistory(): void {
  probeHistory.set([]);
}
