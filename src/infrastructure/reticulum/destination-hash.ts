import { normalizeDestinationHash } from '../../domain/settings';

const nameHashBytes = 10;
const destinationHashBytes = 16;

export function normalizeFullDestinationName(value: string): string | undefined {
  const normalized = value.trim();
  if (!normalized || normalized.split('.').some((component) => component.length === 0)) {
    return undefined;
  }
  return normalized;
}

function hexToBytes(value: string): Uint8Array {
  return Uint8Array.from(
    { length: value.length / 2 },
    (_, index) => Number.parseInt(value.slice(index * 2, index * 2 + 2), 16),
  );
}

function bytesToHex(value: Uint8Array): string {
  return Array.from(value, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function sha256(value: Uint8Array): Promise<Uint8Array> {
  const input = new Uint8Array(value.byteLength);
  input.set(value);
  return new Uint8Array(await crypto.subtle.digest('SHA-256', input.buffer));
}

/**
 * Derives an identity-backed Reticulum destination hash without needing the
 * full public key:
 *
 * name_hash = SHA256(UTF8(full_name))[0:10]
 * destination_hash = SHA256(name_hash || identity_hash)[0:16]
 */
export async function destinationHashFromIdentity(
  identityHash: string,
  fullDestinationName: string,
): Promise<string | undefined> {
  const normalizedIdentityHash = normalizeDestinationHash(identityHash);
  const normalizedName = normalizeFullDestinationName(fullDestinationName);
  if (!normalizedIdentityHash || !normalizedName) return undefined;

  const nameDigest = await sha256(new TextEncoder().encode(normalizedName));
  const hashMaterial = new Uint8Array(nameHashBytes + destinationHashBytes);
  hashMaterial.set(nameDigest.slice(0, nameHashBytes));
  hashMaterial.set(hexToBytes(normalizedIdentityHash), nameHashBytes);
  const destinationDigest = await sha256(hashMaterial);
  return bytesToHex(destinationDigest.slice(0, destinationHashBytes));
}
