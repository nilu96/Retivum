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
    expect(onboardingIsRequired([], [])).toBe(true);
  });

  it('requires onboarding for a sole unnamed identity and no interface', () => {
    expect(onboardingIsRequired([unnamed], [])).toBe(true);
  });

  it('treats an existing Anonymous identity as explicitly named', () => {
    expect(onboardingIsRequired([{ ...unnamed, displayName: 'Anonymous' }], [])).toBe(false);
  });

  it('does not require onboarding for a named identity', () => {
    expect(onboardingIsRequired([{ ...unnamed, displayName: 'Alice' }], [])).toBe(false);
  });

  it('does not require onboarding when more than one identity exists', () => {
    expect(onboardingIsRequired([unnamed, { ...unnamed, id: 'second' }], [])).toBe(false);
  });

  it('counts a disabled interface as configured', () => {
    const configured = { ...createWebSocketInterfaceDraft(), enabled: false };
    expect(onboardingIsRequired([unnamed], [configured])).toBe(false);
  });
});
