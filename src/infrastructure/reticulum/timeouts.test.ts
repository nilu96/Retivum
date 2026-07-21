import { describe, expect, it } from 'vitest';
import { maximumProbePayloadBytes } from './protocol';
import {
  defaultProbeTimeoutMs,
  pathRequestTimeoutMs,
  probeTimeoutMsForPath,
} from './timeouts';

describe('Reticulum timeouts', () => {
  it('defines one shared path request timeout', () => {
    expect(pathRequestTimeoutMs).toBe(20_000);
  });

  it('bounds raw probes to Reticulum single-packet encrypted MDU', () => {
    expect(maximumProbePayloadBytes).toBe(383);
  });

  it('scales probe proof timeouts by the known path hop count', () => {
    expect(probeTimeoutMsForPath({ hasPath: true, hops: 0 })).toBe(10_000);
    expect(probeTimeoutMsForPath({ hasPath: true, hops: 1 })).toBe(14_000);
    expect(probeTimeoutMsForPath({ hasPath: true, hops: 3 })).toBe(22_000);
  });

  it('keeps the default probe timeout without a complete known path', () => {
    expect(probeTimeoutMsForPath()).toBe(defaultProbeTimeoutMs);
    expect(probeTimeoutMsForPath({ hasPath: false, hops: 3 })).toBe(defaultProbeTimeoutMs);
    expect(probeTimeoutMsForPath({ hasPath: true })).toBe(defaultProbeTimeoutMs);
  });
});
