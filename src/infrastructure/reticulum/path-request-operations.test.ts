import { get } from 'svelte/store';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DestinationPathRequestResult } from './protocol';
import {
  clearDestinationPathRequestCooldowns,
  disabledPathRequestDestinationHashes,
  pendingPathRequestDestinationHashes,
  startDestinationPathRequest,
} from './path-request-operations';
import { reticulumRuntime } from './runtime';

describe('path request operations', () => {
  afterEach(() => {
    clearDestinationPathRequestCooldowns();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('drops the cached path and allows only one replacement request per destination', async () => {
    const destinationHash = 'a'.repeat(32);
    let resolveRequest!: (result: DestinationPathRequestResult) => void;
    const drop = vi.spyOn(reticulumRuntime, 'dropDestinationPath').mockResolvedValue(true);
    const request = vi.spyOn(reticulumRuntime, 'requestDestinationPath').mockImplementation(() => (
      new Promise((resolve) => { resolveRequest = resolve; })
    ));

    const first = startDestinationPathRequest(destinationHash);
    const duplicate = startDestinationPathRequest(destinationHash.toUpperCase());
    await Promise.resolve();

    expect(first).toBeDefined();
    expect(duplicate).toBeUndefined();
    expect(drop).toHaveBeenCalledWith(destinationHash);
    expect(request).toHaveBeenCalledWith(destinationHash, expect.any(AbortSignal));
    expect(get(pendingPathRequestDestinationHashes).has(destinationHash)).toBe(true);

    resolveRequest({ ok: true, destinationHash, hops: 2 });
    await first?.result;

    expect(get(pendingPathRequestDestinationHashes).has(destinationHash)).toBe(false);
  });

  it('releases the destination when dropping or requesting fails', async () => {
    const destinationHash = 'b'.repeat(32);
    vi.spyOn(reticulumRuntime, 'dropDestinationPath').mockRejectedValue(new Error('runtime stopped'));

    const operation = startDestinationPathRequest(destinationHash);
    await expect(operation?.result).rejects.toThrow('runtime stopped');

    expect(get(pendingPathRequestDestinationHashes).has(destinationHash)).toBe(false);
  });

  it('keeps a completed request disabled until the shared cooldown expires', async () => {
    vi.useFakeTimers();
    const destinationHash = 'c'.repeat(32);
    vi.spyOn(reticulumRuntime, 'dropDestinationPath').mockResolvedValue(true);
    vi.spyOn(reticulumRuntime, 'requestDestinationPath').mockResolvedValue({
      ok: true,
      destinationHash,
      hops: 1,
    });

    const operation = startDestinationPathRequest(destinationHash);
    await operation?.result;

    expect(get(pendingPathRequestDestinationHashes).has(destinationHash)).toBe(false);
    expect(get(disabledPathRequestDestinationHashes).has(destinationHash)).toBe(true);
    expect(startDestinationPathRequest(destinationHash)).toBeUndefined();

    await vi.advanceTimersByTimeAsync(20_000);
    expect(get(disabledPathRequestDestinationHashes).has(destinationHash)).toBe(false);
  });
});
