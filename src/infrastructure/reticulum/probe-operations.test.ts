import { get } from 'svelte/store';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearProbeHistory, probeHistory } from './probe-history';
import { pendingProbeDestinationHashes, startDestinationProbe } from './probe-operations';
import type { ProbeResult } from './protocol';
import { reticulumRuntime } from './runtime';

describe('probe operations', () => {
  afterEach(() => {
    clearProbeHistory();
    vi.restoreAllMocks();
  });

  it('allows only one pending probe for each destination', async () => {
    const destinationHash = 'a'.repeat(32);
    let resolveProbe!: (result: ProbeResult) => void;
    const runtimeProbe = vi.spyOn(reticulumRuntime, 'probeDestination').mockImplementation(() => new Promise((resolve) => {
      resolveProbe = resolve;
    }));

    const first = startDestinationProbe(destinationHash, 'lxmf.delivery', 20_000, 8);
    const duplicate = startDestinationProbe(destinationHash.toUpperCase(), 'lxmf.delivery', 30_000, 16);

    expect(first).toBeDefined();
    expect(duplicate).toBeUndefined();
    expect(runtimeProbe).toHaveBeenCalledOnce();
    expect(get(pendingProbeDestinationHashes).has(destinationHash)).toBe(true);

    resolveProbe({
      ok: true,
      destinationHash,
      fullDestinationName: 'lxmf.delivery',
      probeSizeBytes: 8,
      roundTripTimeMs: 25,
    });
    await first?.result;

    expect(get(pendingProbeDestinationHashes).has(destinationHash)).toBe(false);
    expect(get(probeHistory)[0]).toEqual(expect.objectContaining({
      destinationHash,
      timeoutMs: 20_000,
      ok: true,
    }));
  });

  it('releases a destination after a rejected probe', async () => {
    const destinationHash = 'b'.repeat(32);
    vi.spyOn(reticulumRuntime, 'probeDestination').mockRejectedValue(new Error('worker stopped'));

    const operation = startDestinationProbe(destinationHash, 'lxmf.delivery', 20_000, 8);
    await expect(operation?.result).rejects.toThrow('worker stopped');
    expect(get(pendingProbeDestinationHashes).has(destinationHash)).toBe(false);
  });

  it('cancels the runtime probe, releases its destination and omits it from history', async () => {
    const destinationHash = 'c'.repeat(32);
    vi.spyOn(reticulumRuntime, 'probeDestination').mockImplementation((
      destination,
      fullDestinationName,
      _timeoutMs,
      probeSizeBytes,
      signal,
    ) => new Promise((resolve) => {
      signal?.addEventListener('abort', () => resolve({
        ok: false,
        destinationHash: destination,
        fullDestinationName,
        probeSizeBytes,
        code: 'PROBE_CANCELLED',
      }), { once: true });
    }));

    const operation = startDestinationProbe(destinationHash, 'lxmf.delivery', 20_000, 8);
    operation?.cancel();
    await operation?.result;

    expect(get(pendingProbeDestinationHashes).has(destinationHash)).toBe(false);
    expect(get(probeHistory)).toEqual([]);
  });

  it('adds live history immediately and resolves cancellation in place', async () => {
    const destinationHash = 'd'.repeat(32);
    vi.spyOn(reticulumRuntime, 'probeDestination').mockImplementation((
      destination,
      fullDestinationName,
      _timeoutMs,
      probeSizeBytes,
      signal,
    ) => new Promise((resolve) => {
      signal?.addEventListener('abort', () => resolve({
        ok: false,
        destinationHash: destination,
        fullDestinationName,
        probeSizeBytes,
        code: 'PROBE_CANCELLED',
      }), { once: true });
    }));

    const operation = startDestinationProbe(
      destinationHash,
      'lxmf.delivery',
      20_000,
      8,
      { liveHistory: true },
    );
    const pendingEntry = get(probeHistory)[0];

    expect(pendingEntry).toEqual(expect.objectContaining({
      status: 'pending',
      destinationHash,
      fullDestinationName: 'lxmf.delivery',
      timeoutMs: 20_000,
      probeSizeBytes: 8,
    }));

    operation?.cancel();
    await operation?.result;

    expect(get(probeHistory)).toHaveLength(1);
    expect(get(probeHistory)[0]).toEqual(expect.objectContaining({
      id: pendingEntry.id,
      status: 'completed',
      timeoutMs: 20_000,
      ok: false,
      code: 'PROBE_CANCELLED',
    }));
  });
});
