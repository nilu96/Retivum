import type { IdentitySummary } from '../../domain/identity';
import type { InterfaceConfig } from '../../domain/settings';

export interface OnboardingPlan {
  initialStep: 1 | 2;
  interfaceStepRequired: boolean;
}

export function determineOnboardingPlan(
  identities: readonly IdentitySummary[],
  interfaces: readonly InterfaceConfig[],
): OnboardingPlan | undefined {
  const hasInterface = interfaces.length > 0;
  const hasNamedIdentity = identities.some((identity) => identity.displayName.trim().length > 0);

  if (hasInterface) {
    return hasNamedIdentity
      ? undefined
      : { initialStep: 1, interfaceStepRequired: false };
  }
  if (identities.length > 1 || hasNamedIdentity) {
    return { initialStep: 2, interfaceStepRequired: true };
  }
  return { initialStep: 1, interfaceStepRequired: true };
}
