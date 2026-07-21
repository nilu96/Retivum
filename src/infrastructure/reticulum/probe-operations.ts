import { get, writable } from 'svelte/store';
import { normalizeDestinationHash } from '../../domain/settings';
import type { ProbeResult } from './protocol';
import {
  beginProbeHistoryEntry,
  recordProbeResult,
  resolveProbeHistoryEntry,
} from './probe-history';
import { reticulumRuntime } from './runtime';

export const pendingProbeDestinationHashes = writable<ReadonlySet<string>>(new Set());
const pendingProbeControllers = new Map<string, AbortController>();

export interface DestinationProbeOperation {
  result: Promise<ProbeResult>;
  cancel: () => void;
}

export interface DestinationProbeOptions {
  liveHistory?: boolean;
}

/**
 * Starts one probe per destination at a time across all application features.
 * Returns `undefined` when that destination already has an in-flight probe.
 */
export function startDestinationProbe(
  destination: string,
  fullDestinationName: string,
  timeoutMs: number,
  probeSizeBytes: number,
  options: DestinationProbeOptions = {},
): DestinationProbeOperation | undefined {
  const destinationHash = normalizeDestinationHash(destination);
  if (!destinationHash || get(pendingProbeDestinationHashes).has(destinationHash)) return undefined;

  pendingProbeDestinationHashes.update((current) => new Set(current).add(destinationHash));
  const controller = new AbortController();
  pendingProbeControllers.set(destinationHash, controller);
  const historyEntryId = options.liveHistory
    ? beginProbeHistoryEntry(destinationHash, fullDestinationName, probeSizeBytes)
    : undefined;
  const result = reticulumRuntime.probeDestination(
    destinationHash,
    fullDestinationName,
    timeoutMs,
    probeSizeBytes,
    controller.signal,
  ).then((result) => {
    if (historyEntryId) resolveProbeHistoryEntry(historyEntryId, result);
    else if (result.code !== 'PROBE_CANCELLED') recordProbeResult(result);
    return result;
  }).catch((error: unknown) => {
    if (historyEntryId) {
      resolveProbeHistoryEntry(historyEntryId, {
        ok: false,
        destinationHash,
        fullDestinationName,
        probeSizeBytes,
        code: 'PROBE_FAILED',
      });
    }
    throw error;
  }).finally(() => {
    if (pendingProbeControllers.get(destinationHash) === controller) {
      pendingProbeControllers.delete(destinationHash);
    }
    pendingProbeDestinationHashes.update((current) => {
      const next = new Set(current);
      next.delete(destinationHash);
      return next;
    });
  });
  return {
    result,
    cancel: () => controller.abort(),
  };
}

export function cancelPendingDestinationProbe(destination: string): boolean {
  const destinationHash = normalizeDestinationHash(destination);
  if (!destinationHash) return false;
  const controller = pendingProbeControllers.get(destinationHash);
  if (!controller) return false;
  controller.abort();
  return true;
}
