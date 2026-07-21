import { writable } from 'svelte/store';
import type { ProbeResult } from './protocol';

interface ProbeHistoryEntryBase {
  id: string;
  destinationHash: string;
  fullDestinationName: string;
  probeSizeBytes: number;
  startedAt: string;
}

export interface PendingProbeHistoryEntry extends ProbeHistoryEntryBase {
  status: 'pending';
}

export interface CompletedProbeHistoryEntry extends ProbeHistoryEntryBase, ProbeResult {
  status: 'completed';
  completedAt: string;
}

export type ProbeHistoryEntry = PendingProbeHistoryEntry | CompletedProbeHistoryEntry;

export const probeHistory = writable<ProbeHistoryEntry[]>([]);

export function recordProbeResult(result: ProbeResult): void {
  const completedAt = new Date().toISOString();
  const entry: CompletedProbeHistoryEntry = {
    ...result,
    id: crypto.randomUUID(),
    status: 'completed',
    startedAt: completedAt,
    completedAt,
  };
  probeHistory.update((entries) => [entry, ...entries].slice(0, 100));
}

export function beginProbeHistoryEntry(
  destinationHash: string,
  fullDestinationName: string,
  probeSizeBytes: number,
): string {
  const id = crypto.randomUUID();
  const entry: PendingProbeHistoryEntry = {
    id,
    status: 'pending',
    destinationHash,
    fullDestinationName,
    probeSizeBytes,
    startedAt: new Date().toISOString(),
  };
  probeHistory.update((entries) => [entry, ...entries].slice(0, 100));
  return id;
}

export function resolveProbeHistoryEntry(id: string, result: ProbeResult): void {
  probeHistory.update((entries) => entries.map((entry) => entry.id === id
    ? {
        ...result,
        id,
        status: 'completed' as const,
        startedAt: entry.startedAt,
        completedAt: new Date().toISOString(),
      }
    : entry));
}

export function clearProbeHistory(): void {
  probeHistory.update((entries) => entries.filter((entry) => entry.status === 'pending'));
}
