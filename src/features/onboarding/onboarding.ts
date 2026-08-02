import type { IdentitySummary } from '../../domain/identity';
import type { InterfaceConfig } from '../../domain/settings';

export function onboardingIsRequired(
  identities: readonly IdentitySummary[],
  interfaces: readonly InterfaceConfig[],
  legacyDefaultDisplayName: string,
): boolean {
  if (interfaces.length > 0) return false;
  return identities.length === 0
    || (
      identities.length === 1
      && (
        !identities[0].displayName.trim()
        || identities[0].displayName === legacyDefaultDisplayName
      )
    );
}
