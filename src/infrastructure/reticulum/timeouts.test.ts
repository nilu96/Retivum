import { describe, expect, it } from 'vitest';
import { maximumProbePayloadBytes } from './protocol';
import { pathRequestTimeoutMs } from './timeouts';

describe('Reticulum timeouts', () => {
  it('defines one shared path request timeout', () => {
    expect(pathRequestTimeoutMs).toBe(20_000);
  });

  it('bounds raw probes to Reticulum single-packet encrypted MDU', () => {
    expect(maximumProbePayloadBytes).toBe(383);
  });
});
