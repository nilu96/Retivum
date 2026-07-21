import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProvisioningNode } from '../../domain/provisioning';
import { ProvisioningClient } from './provisioning-client';
import { ProvisioningRequestFailure, reticulumRuntime } from './runtime';

const node: ProvisioningNode = {
  id: 'management-node',
  destinationHash: '01'.repeat(16),
  publicKey: '02'.repeat(64),
  heardAt: '2026-07-20T10:00:00.000Z',
};

describe('ProvisioningClient reboot behavior', () => {
  afterEach(() => vi.restoreAllMocks());

  it('accepts response timeout after dispatch as an expected reboot race and closes the link', async () => {
    vi.spyOn(reticulumRuntime, 'requestProvisioning')
      .mockRejectedValue(new ProvisioningRequestFailure('PROVISIONING_REQUEST_TIMEOUT'));
    const close = vi.spyOn(reticulumRuntime, 'cancelProvisioning').mockImplementation(() => undefined);

    await expect(new ProvisioningClient(node).reboot()).resolves.toBeUndefined();
    expect(close).toHaveBeenCalledWith(node.destinationHash, true);
  });

  it('still reports path and authorization failures', async () => {
    vi.spyOn(reticulumRuntime, 'requestProvisioning')
      .mockRejectedValue(new ProvisioningRequestFailure('PROVISIONING_IDENTIFY_FAILED'));
    vi.spyOn(reticulumRuntime, 'cancelProvisioning').mockImplementation(() => undefined);

    await expect(new ProvisioningClient(node).reboot()).rejects.toMatchObject({
      code: 'PROVISIONING_IDENTIFY_FAILED',
    });
  });
});
