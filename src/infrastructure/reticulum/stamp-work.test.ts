import { describe, expect, it, vi } from 'vitest';
import { PendingWorkBarrier, StampWorkRegistry } from './stamp-work';

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = () => {};
  const promise = new Promise<void>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

describe('StampWorkRegistry', () => {
  it('runs only one job for the same stamp coordinates at a time', async () => {
    const registry = new StampWorkRegistry();
    const pending = deferred();
    const work = vi.fn(() => pending.promise);

    const first = registry.run('propagation:message:transient:16', work);
    await expect(registry.run('propagation:message:transient:16', work)).resolves.toBe(false);
    expect(work).toHaveBeenCalledTimes(1);

    pending.resolve();
    await expect(first).resolves.toBe(true);
    await expect(registry.run('propagation:message:transient:16', work)).resolves.toBe(true);
    expect(work).toHaveBeenCalledTimes(2);
  });

  it('releases failed jobs so a later request can retry', async () => {
    const registry = new StampWorkRegistry();
    const failed = vi.fn().mockRejectedValueOnce(new Error('generation failed'));

    await expect(registry.run('delivery:message:12', failed)).rejects.toThrow('generation failed');
    await expect(registry.run('delivery:message:12', async () => {})).resolves.toBe(true);
  });

  it('does not let work from a cleared runtime release replacement work', async () => {
    const registry = new StampWorkRegistry();
    const oldWork = deferred();
    const replacementWork = deferred();

    const oldRun = registry.run('propagation:message:transient:16', () => oldWork.promise);
    registry.clear();
    const replacementRun = registry.run(
      'propagation:message:transient:16',
      () => replacementWork.promise,
    );

    oldWork.resolve();
    await expect(oldRun).resolves.toBe(true);
    await expect(registry.run('propagation:message:transient:16', async () => {})).resolves.toBe(false);

    replacementWork.resolve();
    await expect(replacementRun).resolves.toBe(true);
  });
});

describe('PendingWorkBarrier', () => {
  it('waits for every tracked job that was active at the barrier', async () => {
    const barrier = new PendingWorkBarrier();
    const first = deferred();
    const second = deferred();
    barrier.track(first.promise);
    barrier.track(second.promise);
    let settled = false;
    const waiting = barrier.wait().then(() => { settled = true; });

    first.resolve();
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(barrier.size).toBe(1);

    second.resolve();
    await waiting;
    expect(settled).toBe(true);
    expect(barrier.size).toBe(0);
  });

  it('settles after failed work and can discard work from a previous lifecycle', async () => {
    const barrier = new PendingWorkBarrier();
    const previous = deferred();
    barrier.track(previous.promise);
    barrier.clear();
    expect(barrier.size).toBe(0);

    const failure = Promise.reject(new Error('invalid stamp'));
    barrier.track(failure);
    await barrier.wait();
    expect(barrier.size).toBe(0);
    previous.resolve();
  });
});
