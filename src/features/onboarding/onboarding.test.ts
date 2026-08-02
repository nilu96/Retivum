import { describe, expect, it } from 'vitest';
import type { IdentitySummary } from '../../domain/identity';
import { createWebSocketInterfaceDraft } from '../../domain/settings';
import { onboardingIsRequired } from './onboarding';

const unnamed: IdentitySummary = {
  id: 'unnamed',
  displayName: '',
  identityHashHex: 'a'.repeat(32),
  publicKeyHex: 'b'.repeat(64),
};

describe('onboardingIsRequired', () => {
  it('requires onboarding when there is no identity and no interface', () => {
    expect(onboardingIsRequired([], [], 'Anonymous')).toBe(true);
  });

  it('requires onboarding for a sole unnamed identity and no interface', () => {
    expect(onboardingIsRequired([unnamed], [], 'Anonymous')).toBe(true);
  });

  it('continues onboarding for a legacy default Anonymous identity', () => {
    expect(onboardingIsRequired([{ ...unnamed, displayName: 'Anonymous' }], [], 'Anonymous')).toBe(true);
  });

  it('does not require onboarding for a named identity', () => {
    expect(onboardingIsRequired([{ ...unnamed, displayName: 'Alice' }], [], 'Anonymous')).toBe(false);
  });

  it('does not require onboarding when more than one identity exists', () => {
    expect(onboardingIsRequired([unnamed, { ...unnamed, id: 'second' }], [], 'Anonymous')).toBe(false);
  });

  it('counts a disabled interface as configured', () => {
    const configured = { ...createWebSocketInterfaceDraft(), enabled: false };
    expect(onboardingIsRequired([unnamed], [configured], 'Anonymous')).toBe(false);
  });
});
