import {
  normalizeNomadIdentificationPolicy,
  sortNomadBookmarks,
  type NomadBookmark,
} from '../../domain/nomadnet';
import { openRetivumDatabase, requestResult, transactionDone } from './database';

type StoredNomadBookmark = Omit<NomadBookmark, 'identificationPolicy'> & {
  identificationPolicy?: unknown;
  identifyBeforeLoad?: boolean;
};

export class BrowserNomadRepository {
  async loadBookmarks(identityId?: string): Promise<NomadBookmark[]> {
    const database = await openRetivumDatabase();
    try {
      const transaction = database.transaction('nomadBookmarks', 'readonly');
      const bookmarks = await requestResult<StoredNomadBookmark[]>(
        transaction.objectStore('nomadBookmarks').getAll(),
      );
      await transactionDone(transaction);
      return identityId
        ? sortNomadBookmarks(bookmarks
          .filter((item) => item.identityId === identityId)
          .map(({ identifyBeforeLoad, ...item }) => ({
            ...item,
            identificationPolicy: normalizeNomadIdentificationPolicy(
              item.identificationPolicy,
              identifyBeforeLoad,
            ),
          })))
        : [];
    } finally {
      database.close();
    }
  }

  async saveBookmark(bookmark: NomadBookmark): Promise<void> {
    const database = await openRetivumDatabase();
    try {
      const transaction = database.transaction('nomadBookmarks', 'readwrite');
      transaction.objectStore('nomadBookmarks').put(bookmark);
      await transactionDone(transaction);
    } finally {
      database.close();
    }
  }

  async replaceBookmark(previousId: string, bookmark: NomadBookmark): Promise<void> {
    const database = await openRetivumDatabase();
    try {
      const transaction = database.transaction('nomadBookmarks', 'readwrite');
      const store = transaction.objectStore('nomadBookmarks');
      store.put(bookmark);
      if (previousId !== bookmark.id) store.delete(previousId);
      await transactionDone(transaction);
    } finally {
      database.close();
    }
  }

  async deleteBookmark(id: string): Promise<void> {
    const database = await openRetivumDatabase();
    try {
      const transaction = database.transaction('nomadBookmarks', 'readwrite');
      transaction.objectStore('nomadBookmarks').delete(id);
      await transactionDone(transaction);
    } finally {
      database.close();
    }
  }
}
