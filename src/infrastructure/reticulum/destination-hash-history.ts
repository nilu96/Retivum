import { writable } from 'svelte/store';

export interface DestinationHashHistoryEntry {
  identityHash: string;
  fullDestinationName: string;
  destinationHash: string;
  generatedAt: string;
}

const maximumHistoryEntries = 100;

/** In-memory generation history retained while the application remains open. */
export const destinationHashHistory = writable<DestinationHashHistoryEntry[]>([]);

export function recordDestinationHashGeneration(
  identityHash: string,
  fullDestinationName: string,
  destinationHash: string,
): void {
  const entry: DestinationHashHistoryEntry = {
    identityHash,
    fullDestinationName,
    destinationHash,
    generatedAt: new Date().toISOString(),
  };
  destinationHashHistory.update((entries) => [
    entry,
    ...entries.filter((candidate) => (
      candidate.identityHash !== identityHash
      || candidate.fullDestinationName !== fullDestinationName
    )),
  ].slice(0, maximumHistoryEntries));
}

export function clearDestinationHashHistory(): void {
  destinationHashHistory.set([]);
}
