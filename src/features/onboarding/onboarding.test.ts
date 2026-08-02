import { describe, expect, it } from 'vitest';
import type { IdentitySummary } from '../../domain/identity';
import { createWebSocketInterfaceDraft } from '../../domain/settings';
import { determineOnboardingPlan } from './onboarding';

const unnamed: IdentitySummary = {
  id: 'unnamed',
  displayName: '',
  identityHashHex: 'a'.repeat(32),
  publicKeyHex: 'b'.repeat(64),
};
const named = { ...unnamed, id: 'named', displayName: 'Alice' };

describe('determineOnboardingPlan', () => {
  it('starts with identity and then requires an interface for one unnamed identity', () => {
    expect(determineOnboardingPlan([unnamed], [])).toEqual({
      initialStep: 1,
      interfaceStepRequired: true,
    });
    expect(determineOnboardingPlan([], [])).toEqual({
      initialStep: 1,
      interfaceStepRequired: true,
    });
  });

  it('starts with interfaces for one named identity or multiple identities', () => {
    expect(determineOnboardingPlan([named], [])).toEqual({
      initialStep: 2,
      interfaceStepRequired: true,
    });
    expect(determineOnboardingPlan([unnamed, { ...unnamed, id: 'second' }], [])).toEqual({
      initialStep: 2,
      interfaceStepRequired: true,
    });
  });

  it('starts with identity and skips interfaces when only the identity name is missing', () => {
    const configured = { ...createWebSocketInterfaceDraft(), enabled: false };
    expect(determineOnboardingPlan([unnamed], [configured])).toEqual({
      initialStep: 1,
      interfaceStepRequired: false,
    });
  });

  it('does not show onboarding when an identity is named and an interface exists', () => {
    const configured = { ...createWebSocketInterfaceDraft(), enabled: false };
    expect(determineOnboardingPlan([named], [configured])).toBeUndefined();
  });
});
