import type { EncryptedPayload } from './identity';

/**
 * Singleton, identity-independent Reticulum network checkpoint.
 * The payload schema belongs to leviculum-wasm; the application only encrypts
 * and stores the opaque serialized value.
 */
export interface PersistedNetworkStateRecord {
  schemaVersion: 1;
  encryptedSnapshot: EncryptedPayload;
  updatedAt: string;
}
