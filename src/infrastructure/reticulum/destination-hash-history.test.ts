import { get } from 'svelte/store';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearDestinationHashHistory,
  destinationHashHistory,
  recordDestinationHashGeneration,
} from './destination-hash-history';

describe('destination hash generation history', () => {
  beforeEach(() => {
    clearDestinationHashHistory();
    vi.useRealTimers();
  });

  it('keeps newest generations first and moves duplicate inputs to the front', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-21T10:00:00.000Z'));
    recordDestinationHashGeneration('1'.repeat(32), 'lxmf.delivery', 'a'.repeat(32));
    vi.setSystemTime(new Date('2026-08-21T10:01:00.000Z'));
    recordDestinationHashGeneration('2'.repeat(32), 'rnstransport.probe', 'b'.repeat(32));
    vi.setSystemTime(new Date('2026-08-21T10:02:00.000Z'));
    recordDestinationHashGeneration('1'.repeat(32), 'lxmf.delivery', 'a'.repeat(32));

    expect(get(destinationHashHistory)).toEqual([
      expect.objectContaining({ identityHash: '1'.repeat(32), generatedAt: '2026-08-21T10:02:00.000Z' }),
      expect.objectContaining({ identityHash: '2'.repeat(32), generatedAt: '2026-08-21T10:01:00.000Z' }),
    ]);
  });
});
