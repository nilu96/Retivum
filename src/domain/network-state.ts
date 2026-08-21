import type { EncryptedPayload } from './identity';

/**
 * Singleton, identity-independent Reticulum network checkpoint.
 * Version 1 stored the opaque Leviculum snapshot directly. Version 2 wraps
 * network paths in Retivum's stable-interface checkpoint before encryption.
 */
interface PersistedNetworkStateRecordBase {
  encryptedSnapshot: EncryptedPayload;
  updatedAt: string;
}

export type PersistedNetworkStateRecord = PersistedNetworkStateRecordBase & (
  | { schemaVersion: 1; revision?: never }
  | { schemaVersion: 2; revision: number }
);
