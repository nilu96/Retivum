export class StampWorkRegistry {
  private readonly active = new Map<string, symbol>();

  async run(key: string, work: () => Promise<void>): Promise<boolean> {
    if (this.active.has(key)) return false;
    const token = Symbol(key);
    this.active.set(key, token);
    try {
      await work();
      return true;
    } finally {
      if (this.active.get(key) === token) this.active.delete(key);
    }
  }

  clear(): void {
    this.active.clear();
  }
}

export class PendingWorkBarrier {
  private readonly pending = new Set<Promise<unknown>>();

  track<T>(work: Promise<T>): Promise<T> {
    this.pending.add(work);
    void work.then(
      () => this.pending.delete(work),
      () => this.pending.delete(work),
    );
    return work;
  }

  async wait(): Promise<void> {
    await Promise.allSettled([...this.pending]);
  }

  clear(): void {
    this.pending.clear();
  }

  get size(): number {
    return this.pending.size;
  }
}
