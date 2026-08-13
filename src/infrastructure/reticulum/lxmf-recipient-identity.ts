export function publicKeyMatchesLxmfDeliveryDestination(
  destinationHash: string,
  publicKey: Uint8Array | undefined,
  deriveDestination: (fullDestinationName: string, publicKey: Uint8Array) => Uint8Array,
): boolean {
  if (!/^[0-9a-f]{32}$/.test(destinationHash) || publicKey?.byteLength !== 64) return false;
  try {
    const expected = new Uint8Array(16);
    for (let index = 0; index < expected.length; index += 1) {
      expected[index] = Number.parseInt(destinationHash.slice(index * 2, index * 2 + 2), 16);
    }
    const derived = deriveDestination('lxmf.delivery', publicKey);
    return derived.byteLength === expected.byteLength
      && derived.every((value, index) => value === expected[index]);
  } catch {
    return false;
  }
}
