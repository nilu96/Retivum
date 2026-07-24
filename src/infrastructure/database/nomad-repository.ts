import type { NomadBookmark } from '../../domain/nomadnet';
import { openRetivumDatabase, requestResult, transactionDone } from './database';

export class BrowserNomadRepository {
  async loadBookmarks(identityId?: string): Promise<NomadBookmark[]> {
    const database = await openRetivumDatabase();
    try {
      const transaction = database.transaction('nomadBookmarks', 'readonly');
      const bookmarks = await requestResult<NomadBookmark[]>(
        transaction.objectStore('nomadBookmarks').getAll(),
      );
      await transactionDone(transaction);
      return identityId
        ? bookmarks.filter((item) => item.identityId === identityId)
          .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
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
