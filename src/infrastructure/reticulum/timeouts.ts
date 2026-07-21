/**
 * Maximum time spent waiting for a destination path to be discovered.
 *
 * Path discovery is shared by probes, NomadNet and provisioning. Keeping the
 * timeout here prevents those callers from applying different network-level
 * path request policies.
 */
export const pathRequestTimeoutMs = 20_000;
