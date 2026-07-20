export interface LxmaAddress {
  destinationHash: string;
  publicKey: string;
}

export function createLxmaAddress(destinationHash: string, publicKey: string): string | undefined {
  const normalizedDestination = destinationHash.trim().toLowerCase();
  const normalizedPublicKey = publicKey.trim().toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(normalizedDestination) || !/^[0-9a-f]{128}$/.test(normalizedPublicKey)) {
    return undefined;
  }
  return `lxma://${normalizedDestination}:${normalizedPublicKey}`;
}

export function parseLxmaAddress(value: string): LxmaAddress | undefined {
  const match = value.trim().match(/^lxma:\/\/([0-9a-f]{32}):([0-9a-f]{128})$/i);
  if (!match) return undefined;
  return { destinationHash: match[1].toLowerCase(), publicKey: match[2].toLowerCase() };
}
