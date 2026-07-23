export function normalizeInDestinationHashes(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const destinationHashes = new Set<string>();

  for (const item of value) {
    const destinationHash = bytes(item);
    if (destinationHash?.byteLength === 16) destinationHashes.add(bytesToHex(destinationHash));
  }

  return Array.from(destinationHashes).sort();
}

function bytes(value: unknown): Uint8Array | undefined {
  if (value === undefined || value === null) return undefined;
  try {
    return value instanceof Uint8Array ? value : new Uint8Array(value as ArrayLike<number>);
  } catch {
    return undefined;
  }
}

function bytesToHex(value: Uint8Array): string {
  return Array.from(value, (byte) => byte.toString(16).padStart(2, '0')).join('');
}
