import type { PersistedIdentityRecord } from '../../domain/identity';
import { openRetivumDatabase, requestResult, transactionDone } from './database';

const wrappingKeyId = 'identity-wrapping-key:v1';
const activeIdentitySetting = 'activeIdentityId';

export class BrowserIdentityRepository {
  async getOrCreateWrappingKey(): Promise<CryptoKey> {
    const existing = await this.loadWrappingKey();
    if (existing) return existing;

    const generated = await crypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    );
    const database = await openRetivumDatabase();
    try {
      const transaction = database.transaction('secrets', 'readwrite');
      transaction.objectStore('secrets').put(generated, wrappingKeyId);
      await transactionDone(transaction);
      return generated;
    } finally {
      database.close();
    }
  }

  async loadActiveIdentity(): Promise<PersistedIdentityRecord | undefined> {
    const database = await openRetivumDatabase();
    try {
      const settingsTransaction = database.transaction('settings', 'readonly');
      const activeId = await requestResult<string | undefined>(settingsTransaction.objectStore('settings').get(activeIdentitySetting));
      await transactionDone(settingsTransaction);
      if (!activeId) return undefined;

      const identityTransaction = database.transaction('identities', 'readonly');
      const identity = await requestResult<PersistedIdentityRecord | undefined>(identityTransaction.objectStore('identities').get(activeId));
      await transactionDone(identityTransaction);
      return identity;
    } finally {
      database.close();
    }
  }

  async loadAll(): Promise<PersistedIdentityRecord[]> {
    const database = await openRetivumDatabase();
    try {
      const transaction = database.transaction('identities', 'readonly');
      const identities = await requestResult<PersistedIdentityRecord[]>(transaction.objectStore('identities').getAll());
      await transactionDone(transaction);
      return identities.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    } finally {
      database.close();
    }
  }

  async loadById(id: string): Promise<PersistedIdentityRecord | undefined> {
    const database = await openRetivumDatabase();
    try {
      const transaction = database.transaction('identities', 'readonly');
      const identity = await requestResult<PersistedIdentityRecord | undefined>(transaction.objectStore('identities').get(id));
      await transactionDone(transaction);
      return identity;
    } finally {
      database.close();
    }
  }

  async save(identity: PersistedIdentityRecord): Promise<void> {
    const database = await openRetivumDatabase();
    try {
      const transaction = database.transaction('identities', 'readwrite');
      transaction.objectStore('identities').put(identity);
      await transactionDone(transaction);
    } finally {
      database.close();
    }
  }

  async setActive(id: string): Promise<void> {
    const database = await openRetivumDatabase();
    try {
      const transaction = database.transaction(['settings', 'identities'], 'readwrite');
      const identity = await requestResult<PersistedIdentityRecord | undefined>(transaction.objectStore('identities').get(id));
      if (!identity) throw new Error('IDENTITY_NOT_FOUND');
      transaction.objectStore('settings').put(id, activeIdentitySetting);
      await transactionDone(transaction);
    } finally {
      database.close();
    }
  }

  async delete(id: string): Promise<void> {
    const database = await openRetivumDatabase();
    try {
      const transaction = database.transaction(['settings', 'identities'], 'readwrite');
      const activeId = await requestResult<string | undefined>(transaction.objectStore('settings').get(activeIdentitySetting));
      if (activeId === id) throw new Error('ACTIVE_IDENTITY_DELETE_FORBIDDEN');
      transaction.objectStore('identities').delete(id);
      await transactionDone(transaction);
    } finally {
      database.close();
    }
  }

  async saveAndActivate(identity: PersistedIdentityRecord): Promise<void> {
    const database = await openRetivumDatabase();
    try {
      const transaction = database.transaction(['settings', 'identities'], 'readwrite');
      transaction.objectStore('identities').put(identity);
      transaction.objectStore('settings').put(identity.id, activeIdentitySetting);
      await transactionDone(transaction);
    } finally {
      database.close();
    }
  }

  private async loadWrappingKey(): Promise<CryptoKey | undefined> {
    const database = await openRetivumDatabase();
    try {
      const transaction = database.transaction('secrets', 'readonly');
      const key = await requestResult<CryptoKey | undefined>(transaction.objectStore('secrets').get(wrappingKeyId));
      await transactionDone(transaction);
      return key;
    } finally {
      database.close();
    }
  }
}
