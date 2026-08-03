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
