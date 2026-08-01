import { describe, expect, it } from 'vitest';
import type { IdentitySummary } from '../../domain/identity';
import { createWebSocketInterfaceDraft } from '../../domain/settings';
import { onboardingIsRequired } from './onboarding';

const anonymous: IdentitySummary = {
  id: 'anonymous',
  displayName: 'Anonymous',
  identityHashHex: 'a'.repeat(32),
  publicKeyHex: 'b'.repeat(64),
};

describe('onboardingIsRequired', () => {
  it('requires onboarding when there is no identity and no interface', () => {
    expect(onboardingIsRequired([], [], 'Anonymous')).toBe(true);
  });

  it('requires onboarding for only the default Anonymous identity and no interface', () => {
    expect(onboardingIsRequired([anonymous], [], 'Anonymous')).toBe(true);
  });

  it('does not require onboarding for a named identity', () => {
    expect(onboardingIsRequired([{ ...anonymous, displayName: 'Alice' }], [], 'Anonymous')).toBe(false);
  });

  it('does not require onboarding when more than one identity exists', () => {
    expect(onboardingIsRequired([anonymous, { ...anonymous, id: 'second' }], [], 'Anonymous')).toBe(false);
  });

  it('counts a disabled interface as configured', () => {
    const configured = { ...createWebSocketInterfaceDraft(), enabled: false };
    expect(onboardingIsRequired([anonymous], [configured], 'Anonymous')).toBe(false);
  });
});
