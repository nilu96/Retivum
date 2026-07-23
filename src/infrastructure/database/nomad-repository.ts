import type { NomadAnnounce, NomadBookmark } from '../../domain/nomadnet';
import { openRetivumDatabase, requestResult, transactionDone } from './database';

export class BrowserNomadRepository {
  async load(identityId?: string): Promise<{ announces: NomadAnnounce[]; bookmarks: NomadBookmark[] }> {
    const database = await openRetivumDatabase();
    try {
      const transaction = database.transaction(['nomadAnnounces', 'nomadBookmarks'], 'readonly');
      const [announces, bookmarks] = await Promise.all([
        requestResult<NomadAnnounce[]>(transaction.objectStore('nomadAnnounces').getAll()),
        requestResult<NomadBookmark[]>(transaction.objectStore('nomadBookmarks').getAll()),
        transactionDone(transaction),
      ]);
      return {
        announces: announces.sort((left, right) => right.heardAt.localeCompare(left.heardAt)),
        bookmarks: identityId
          ? bookmarks.filter((item) => item.identityId === identityId)
            .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
          : [],
      };
    } finally {
      database.close();
    }
  }

  async saveAnnounce(announce: NomadAnnounce): Promise<void> {
    await this.put('nomadAnnounces', announce);
  }

  async saveBookmark(bookmark: NomadBookmark): Promise<void> {
    await this.put('nomadBookmarks', bookmark);
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

  private async put(store: 'nomadAnnounces' | 'nomadBookmarks', value: NomadAnnounce | NomadBookmark): Promise<void> {
    const database = await openRetivumDatabase();
    try {
      const transaction = database.transaction(store, 'readwrite');
      transaction.objectStore(store).put(value);
      await transactionDone(transaction);
    } finally {
      database.close();
    }
  }
}
