import type { ChatAnnounce, ChatBlockedDestination, ChatContact, ChatMessage } from '../../domain/chat';
import { messageTime } from '../../domain/chat';
import { openRetivumDatabase, requestResult, transactionDone } from './database';

export interface ChatDirectory {
  announces: ChatAnnounce[];
  contacts: ChatContact[];
  messages: ChatMessage[];
  blockedDestinations: ChatBlockedDestination[];
}

export class BrowserChatRepository {
  async load(identityId: string): Promise<ChatDirectory> {
    const database = await openRetivumDatabase();
    try {
      const transaction = database.transaction(
        ['chatAnnounces', 'chatContacts', 'chatMessages', 'chatBlockedDestinations'],
        'readonly',
      );
      const [announces, contacts, messages, blockedDestinations] = await Promise.all([
        requestResult<ChatAnnounce[]>(transaction.objectStore('chatAnnounces').getAll()),
        requestResult<ChatContact[]>(transaction.objectStore('chatContacts').getAll()),
        requestResult<ChatMessage[]>(transaction.objectStore('chatMessages').getAll()),
        requestResult<ChatBlockedDestination[]>(transaction.objectStore('chatBlockedDestinations').getAll()),
        transactionDone(transaction),
      ]);
      return {
        announces: announces
          .filter((item) => item.identityId === identityId)
          .sort((left, right) => Date.parse(right.heardAt) - Date.parse(left.heardAt)),
        contacts: contacts
          .filter((item) => item.identityId === identityId)
          .sort((left, right) => left.name.localeCompare(right.name)),
        messages: messages
          .filter((item) => item.identityId === identityId)
          .sort((left, right) => messageTime(right) - messageTime(left)),
        blockedDestinations: blockedDestinations
          .filter((item) => item.identityId === identityId)
          .sort((left, right) => Date.parse(right.blockedAt) - Date.parse(left.blockedAt)),
      };
    } finally {
      database.close();
    }
  }

  async saveAnnounce(announce: ChatAnnounce): Promise<void> {
    await this.put('chatAnnounces', announce);
  }

  async saveMessage(message: ChatMessage): Promise<void> {
    await this.put('chatMessages', message);
  }

  async replaceMessage(previousId: string, message: ChatMessage): Promise<void> {
    const database = await openRetivumDatabase();
    try {
      const transaction = database.transaction('chatMessages', 'readwrite');
      const store = transaction.objectStore('chatMessages');
      if (previousId !== message.id) store.delete(previousId);
      store.put(structuredClone(message));
      await transactionDone(transaction);
    } finally {
      database.close();
    }
  }

  async deleteMessage(id: string): Promise<void> {
    await this.deleteMessages([id]);
  }

  async deleteMessages(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const database = await openRetivumDatabase();
    try {
      const transaction = database.transaction('chatMessages', 'readwrite');
      const store = transaction.objectStore('chatMessages');
      for (const id of ids) store.delete(id);
      await transactionDone(transaction);
    } finally {
      database.close();
    }
  }

  async deleteExpiredMessages(identityId: string, before: number): Promise<string[]> {
    if (!Number.isFinite(before)) return [];
    const database = await openRetivumDatabase();
    try {
      const transaction = database.transaction('chatMessages', 'readwrite');
      const store = transaction.objectStore('chatMessages');
      const messages = await requestResult<ChatMessage[]>(store.getAll());
      const expiredIds = messages.filter((message) => {
        const timestamp = messageTime(message);
        return message.identityId === identityId && Number.isFinite(timestamp) && timestamp < before;
      }).map((message) => message.id);
      for (const id of expiredIds) store.delete(id);
      await transactionDone(transaction);
      return expiredIds;
    } finally {
      database.close();
    }
  }

  async saveContact(contact: ChatContact): Promise<void> {
    await this.put('chatContacts', contact);
  }

  async deleteContact(id: string): Promise<void> {
    const database = await openRetivumDatabase();
    try {
      const transaction = database.transaction('chatContacts', 'readwrite');
      transaction.objectStore('chatContacts').delete(id);
      await transactionDone(transaction);
    } finally {
      database.close();
    }
  }

  async saveBlockedDestination(blocked: ChatBlockedDestination): Promise<void> {
    const database = await openRetivumDatabase();
    try {
      const transaction = database.transaction('chatBlockedDestinations', 'readwrite');
      transaction.objectStore('chatBlockedDestinations').put(structuredClone(blocked));
      await transactionDone(transaction);
    } finally {
      database.close();
    }
  }

  async deleteBlockedDestination(id: string): Promise<void> {
    const database = await openRetivumDatabase();
    try {
      const transaction = database.transaction('chatBlockedDestinations', 'readwrite');
      transaction.objectStore('chatBlockedDestinations').delete(id);
      await transactionDone(transaction);
    } finally {
      database.close();
    }
  }

  private async put(
    storeName: 'chatAnnounces' | 'chatContacts' | 'chatMessages',
    value: ChatAnnounce | ChatContact | ChatMessage,
  ): Promise<void> {
    const database = await openRetivumDatabase();
    try {
      const transaction = database.transaction(storeName, 'readwrite');
      transaction.objectStore(storeName).put(structuredClone(value));
      await transactionDone(transaction);
    } finally {
      database.close();
    }
  }
}
