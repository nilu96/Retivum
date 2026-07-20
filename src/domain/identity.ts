export interface EncryptedPayload {
  algorithm: 'AES-GCM';
  iv: Uint8Array;
  ciphertext: Uint8Array;
}

export interface PersistedIdentityRecord {
  id: string;
  schemaVersion: 1;
  label: string;
  displayName: string;
  identityHash: Uint8Array;
  publicKey: Uint8Array;
  encryptedPrivateKey: EncryptedPayload;
  encryptedSnapshot?: EncryptedPayload;
  /** Last successful regular broadcast announce for this identity. */
  lastAnnouncedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface IdentitySummary {
  id: string;
  displayName: string;
  identityHashHex: string;
  publicKeyHex: string;
}

export interface IdentityBackupV1 {
  format: 'retivum-identity';
  version: 1;
  label: string;
  displayName: string;
  identityHash: string;
  privateKey: string;
  exportedAt: string;
}

export interface ParsedIdentityBackup {
  label: string;
  displayName: string;
  expectedIdentityHash?: string;
  privateKey: Uint8Array;
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function identitySummary(record: PersistedIdentityRecord): IdentitySummary {
  return {
    id: record.id,
    displayName: record.displayName,
    identityHashHex: bytesToHex(record.identityHash),
    publicKeyHex: bytesToHex(record.publicKey),
  };
}

export function identityLastAnnouncedAtMs(record: PersistedIdentityRecord | undefined): number | undefined {
  const value = record?.lastAnnouncedAt;
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function identityAnnounceIsDue(
  record: PersistedIdentityRecord | undefined,
  intervalMinutes: number,
  nowMs: number,
): boolean {
  if (intervalMinutes <= 0) return false;
  const lastAnnouncedAt = identityLastAnnouncedAtMs(record);
  return lastAnnouncedAt === undefined || nowMs - lastAnnouncedAt >= intervalMinutes * 60_000;
}

export function upsertIdentitySummary(
  identities: IdentitySummary[],
  summary: IdentitySummary,
): IdentitySummary[] {
  return identities.some((identity) => identity.id === summary.id)
    ? identities.map((identity) => identity.id === summary.id ? summary : identity)
    : [...identities, summary];
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export function parseIdentityBackup(value: string): ParsedIdentityBackup | undefined {
  try {
    const parsed = JSON.parse(value) as Partial<IdentityBackupV1>;
    if (
      parsed.format !== 'retivum-identity'
      || parsed.version !== 1
      || typeof parsed.label !== 'string'
      || typeof parsed.displayName !== 'string'
      || typeof parsed.identityHash !== 'string'
      || !/^[0-9a-f]{32}$/i.test(parsed.identityHash)
      || typeof parsed.privateKey !== 'string'
      || !parsed.displayName.trim()
    ) return undefined;
    const privateKey = base64ToBytes(parsed.privateKey);
    if (privateKey.byteLength === 0 || privateKey.byteLength > 512) return undefined;
    return {
      label: parsed.label.trim(),
      displayName: parsed.displayName.trim(),
      expectedIdentityHash: parsed.identityHash.toLowerCase(),
      privateKey,
    };
  } catch {
    return undefined;
  }
}

export function parseIdentityFile(bytes: Uint8Array): ParsedIdentityBackup | undefined {
  if (bytes.byteLength === 0 || bytes.byteLength > 64 * 1024) return undefined;
  const firstContentByte = bytes.find((byte) => ![0x09, 0x0a, 0x0d, 0x20].includes(byte));
  if (firstContentByte === 0x7b) return parseIdentityBackup(new TextDecoder().decode(bytes));
  if (bytes.byteLength !== 64) return undefined;
  return { label: '', displayName: '', privateKey: Uint8Array.from(bytes) };
}
