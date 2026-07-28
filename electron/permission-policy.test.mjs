import { describe, expect, it } from 'vitest';
import {
  permissionCheckAllowed,
  permissionRequestDecision,
} from './permission-policy.mjs';

describe('Electron renderer permission policy', () => {
  it('allows sanitized clipboard writes from the trusted main frame', () => {
    const details = { isMainFrame: true };

    expect(permissionCheckAllowed(true, 'clipboard-sanitized-write', details)).toBe(true);
    expect(permissionRequestDecision(true, 'clipboard-sanitized-write', details)).toBe('allow');
  });

  it('denies clipboard writes from untrusted contents and subframes', () => {
    expect(permissionCheckAllowed(
      false,
      'clipboard-sanitized-write',
      { isMainFrame: true },
    )).toBe(false);
    expect(permissionRequestDecision(
      false,
      'clipboard-sanitized-write',
      { isMainFrame: true },
    )).toBe('deny');
    expect(permissionCheckAllowed(
      true,
      'clipboard-sanitized-write',
      { isMainFrame: false },
    )).toBe(false);
    expect(permissionRequestDecision(
      true,
      'clipboard-sanitized-write',
      { isMainFrame: false },
    )).toBe('deny');
  });

  it('continues to deny clipboard reads', () => {
    const details = { isMainFrame: true };

    expect(permissionCheckAllowed(true, 'clipboard-read', details)).toBe(false);
    expect(permissionRequestDecision(true, 'clipboard-read', details)).toBe('deny');
  });
});
