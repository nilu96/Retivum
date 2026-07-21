/**
 * Maximum time spent waiting for a destination path to be discovered.
 *
 * Path discovery is shared by probes, NomadNet and provisioning. Keeping the
 * timeout here prevents those callers from applying different network-level
 * path request policies.
 */
export const pathRequestTimeoutMs = 20_000;

export const defaultProbeTimeoutMs = 20_000;
export const probeTimeoutBaseMs = 10_000;
export const probeTimeoutPerHopMs = 4_000;

/**
 * Proof timeout for a probe sent over the current cached path.
 *
 * Unknown or incomplete path state keeps the conservative default. Path
 * discovery itself continues to use `pathRequestTimeoutMs` independently.
 */
export function probeTimeoutMsForPath(status?: { hasPath: boolean; hops?: number }): number {
  if (!status?.hasPath || !Number.isSafeInteger(status.hops) || status.hops === undefined || status.hops < 0) {
    return defaultProbeTimeoutMs;
  }
  return probeTimeoutBaseMs + status.hops * probeTimeoutPerHopMs;
}
