import { describe, expect, it } from 'vitest';
import { isRetryableBleError } from './byte-connections';

describe('BLE connection recovery', () => {
  it.each([
    new DOMException('GATT operation failed', 'NetworkError'),
    new Error('Device disconnected during service discovery'),
    new Error('Connection interrupted while pairing'),
    new Error('Encryption is insufficient'),
    new Error('authorize RX characteristic timed out'),
  ])('retries transient pairing and GATT failures', (error) => {
    expect(isRetryableBleError(error)).toBe(true);
  });

  it('does not retry an authorization failure', () => {
    expect(isRetryableBleError(new Error('RNODE_BLE_NOT_AUTHORIZED'))).toBe(false);
  });
});
