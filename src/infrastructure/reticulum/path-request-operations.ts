import { derived, get, writable } from 'svelte/store';
import { normalizeDestinationHash } from '../../domain/settings';
import type { DestinationPathRequestResult } from './protocol';
import { reticulumRuntime } from './runtime';
import { pathRequestTimeoutMs } from './timeouts';

export const pendingPathRequestDestinationHashes = writable<ReadonlySet<string>>(new Set());
export const pathRequestCooldownDestinationHashes = writable<ReadonlySet<string>>(new Set());
export const disabledPathRequestDestinationHashes = derived(
  [pendingPathRequestDestinationHashes, pathRequestCooldownDestinationHashes],
  ([$pending, $cooldown]) => new Set([...$pending, ...$cooldown]),
);
const pendingPathRequestControllers = new Map<string, AbortController>();
const pathRequestCooldownTimers = new Map<string, ReturnType<typeof setTimeout>>();

export interface DestinationPathRequestOperation {
  result: Promise<DestinationPathRequestResult>;
  cancel: () => void;
}

/** Drops a cached route and starts one replacement request per destination across all features. */
export function startDestinationPathRequest(destination: string): DestinationPathRequestOperation | undefined {
  const destinationHash = normalizeDestinationHash(destination);
  if (!destinationHash || get(disabledPathRequestDestinationHashes).has(destinationHash)) return undefined;

  beginDestinationPathRequestCooldown(destinationHash);
  pendingPathRequestDestinationHashes.update((current) => new Set(current).add(destinationHash));
  const controller = new AbortController();
  pendingPathRequestControllers.set(destinationHash, controller);
  const result = reticulumRuntime.dropDestinationPath(destinationHash)
    .then(() => reticulumRuntime.requestDestinationPath(destinationHash, controller.signal))
    .finally(() => {
      if (pendingPathRequestControllers.get(destinationHash) === controller) {
        pendingPathRequestControllers.delete(destinationHash);
      }
      pendingPathRequestDestinationHashes.update((current) => {
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

function beginDestinationPathRequestCooldown(destinationHash: string): void {
  const currentTimer = pathRequestCooldownTimers.get(destinationHash);
  if (currentTimer !== undefined) clearTimeout(currentTimer);
  pathRequestCooldownDestinationHashes.update((current) => new Set(current).add(destinationHash));
  const timer = setTimeout(() => {
    pathRequestCooldownTimers.delete(destinationHash);
    pathRequestCooldownDestinationHashes.update((current) => {
      const next = new Set(current);
      next.delete(destinationHash);
      return next;
    });
  }, pathRequestTimeoutMs);
  pathRequestCooldownTimers.set(destinationHash, timer);
  (timer as ReturnType<typeof setTimeout> & { unref?: () => void }).unref?.();
}

export function clearDestinationPathRequestCooldowns(): void {
  for (const timer of pathRequestCooldownTimers.values()) clearTimeout(timer);
  pathRequestCooldownTimers.clear();
  pathRequestCooldownDestinationHashes.set(new Set());
}

export function cancelPendingDestinationPathRequest(destination: string): boolean {
  const destinationHash = normalizeDestinationHash(destination);
  if (!destinationHash) return false;
  const controller = pendingPathRequestControllers.get(destinationHash);
  if (!controller) return false;
  controller.abort();
  return true;
}
