import type { RuntimeConfiguration } from './protocol';

/**
 * Outbound-delivery and scheduling preferences can be applied without
 * replacing the Reticulum node. Rebuilding for those changes would discard
 * live paths, links and propagation-node announcements.
 */
export function requiresReticulumRuntimeRebuild(
  current: RuntimeConfiguration | undefined,
  next: RuntimeConfiguration,
): boolean {
  if (!current) return true;
  return current.preferences.transportEnabled !== next.preferences.transportEnabled
    || current.preferences.lxmf.inboundStampCost !== next.preferences.lxmf.inboundStampCost
    || JSON.stringify(current.interfaces) !== JSON.stringify(next.interfaces);
}
