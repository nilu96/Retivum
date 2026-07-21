import { get, writable } from 'svelte/store';
import { normalizeDestinationHash } from '../../domain/settings';
import type { ProbeResult } from './protocol';
import { recordProbeResult } from './probe-history';
import { reticulumRuntime } from './runtime';

export const pendingProbeDestinationHashes = writable<ReadonlySet<string>>(new Set());

export interface DestinationProbeOperation {
  result: Promise<ProbeResult>;
  cancel: () => void;
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
): DestinationProbeOperation | undefined {
  const destinationHash = normalizeDestinationHash(destination);
  if (!destinationHash || get(pendingProbeDestinationHashes).has(destinationHash)) return undefined;

  pendingProbeDestinationHashes.update((current) => new Set(current).add(destinationHash));
  const controller = new AbortController();
  const result = reticulumRuntime.probeDestination(
    destinationHash,
    fullDestinationName,
    timeoutMs,
    probeSizeBytes,
    controller.signal,
  ).then((result) => {
    if (result.code !== 'PROBE_CANCELLED') recordProbeResult(result);
    return result;
  }).finally(() => {
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
