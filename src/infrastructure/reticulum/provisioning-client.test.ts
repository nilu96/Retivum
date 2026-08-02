import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  decodeProvisioningEnvelope,
  encodeProvisioningMessage,
  provisioningOperations,
  type ProvisioningNode,
  type ProvisioningValue,
} from '../../domain/provisioning';
import { ProvisioningClient, ProvisioningFieldFailure } from './provisioning-client';
import { ProvisioningRequestFailure, reticulumRuntime } from './runtime';

const node: ProvisioningNode = {
  id: 'management-node',
  destinationHash: '01'.repeat(16),
  lastAnnouncedAt: '2026-07-20T10:00:00.000Z',
};

describe('ProvisioningClient', () => {
  afterEach(() => vi.restoreAllMocks());

  it('stages and commits as separate requests through the same client', async () => {
    const request = vi.spyOn(reticulumRuntime, 'requestProvisioning')
      .mockResolvedValueOnce(Uint8Array.of(
        0x93, 0x64, 0x01,
        0x83, 0x01, 0x01, 0x02, 0xc2, 0x03, 0x90,
      ))
      .mockResolvedValueOnce(Uint8Array.of(
        0x93, 0x64, 0x02,
        0x82, 0x01, 0x01, 0x02, 0xc2,
      ));
    const client = new ProvisioningClient(node);

    await expect(client.stage({ 4: { 2: 144_800_000 } })).resolves.toMatchObject({
      applied: 1,
      draftHasReboot: false,
      fieldErrors: [],
    });
    await expect(client.commit()).resolves.toMatchObject({ applied: 1, needsReboot: false });

    expect(decodeProvisioningEnvelope(request.mock.calls[0][1]).operation)
      .toBe(provisioningOperations.setState);
    expect(decodeProvisioningEnvelope(request.mock.calls[1][1]).operation)
      .toBe(provisioningOperations.commit);
    expect(request.mock.calls[0][2]).toBe(false);
    expect(request.mock.calls[1][2]).toBe(false);
  });

  it('preserves remote field rejection details in a typed failure', async () => {
    vi.spyOn(reticulumRuntime, 'requestProvisioning').mockResolvedValue(encodeProvisioningMessage([
      provisioningOperations.acknowledgement,
      1,
      new Map<ProvisioningValue, ProvisioningValue>([
        [1, 0],
        [2, false],
        [3, [[4, 2, 6]]],
      ]),
    ]));

    await expect(new ProvisioningClient(node).stage({ 4: { 2: 1.2 } }))
      .rejects.toEqual(new ProvisioningFieldFailure(4, 2, 6));
  });

  it('decodes structured values and drafts and uses structured mutation payloads', async () => {
    const stateBody = new Map<ProvisioningValue, ProvisioningValue>([
      [1, new Map([[4, new Map([[2, 144_800_000], [3, 125_000]])]])],
      [2, new Map([[4, new Map([[3, 250_000]])]])],
      [3, 0x12345678],
    ]);
    const stageBody = new Map<ProvisioningValue, ProvisioningValue>([
      [1, 1],
      [2, false],
      [3, []],
      [4, new Map([[4, new Map([[2, 144_800_000], [3, 125_000]])]])],
      [5, new Map([[4, new Map([[3, 250_000]])]])],
      [6, 0x87654321],
    ]);
    const request = vi.spyOn(reticulumRuntime, 'requestProvisioning')
      .mockResolvedValueOnce(encodeProvisioningMessage([100, 1, stateBody]))
      .mockResolvedValueOnce(encodeProvisioningMessage([100, 2, stageBody]));
    const client = new ProvisioningClient(node);

    await expect(client.getStateSnapshot([4], true)).resolves.toEqual({
      values: { 4: { 2: 144_800_000, 3: 125_000 } },
      drafts: { 4: { 3: 250_000 } },
      hash: 0x12345678,
      unchanged: false,
      structured: true,
    });
    await expect(client.stage({ 4: { 3: 250_000 } })).resolves.toMatchObject({
      applied: 1,
      values: { 4: { 2: 144_800_000, 3: 125_000 } },
      drafts: { 4: { 3: 250_000 } },
    });

    const stageRequest = decodeProvisioningEnvelope(request.mock.calls[1][1]);
    expect(stageRequest.operation).toBe(provisioningOperations.setState);
    expect(stageRequest.body).toBeInstanceOf(Map);
    expect((stageRequest.body as Map<ProvisioningValue, ProvisioningValue>).get(3)).toBeInstanceOf(Map);
    expect((stageRequest.body as Map<ProvisioningValue, ProvisioningValue>).get(5)).toBe(true);
  });

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
