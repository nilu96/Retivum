import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { openRetivumDatabase, requestResult, transactionDone } from './database';
import { BrowserChatRepository } from './chat-repository';
import { BrowserKnownDestinationRepository } from './known-destination-repository';

function deleteDatabase(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase('retivum');
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('DATABASE_DELETE_BLOCKED'));
  });
}

describe('BrowserChatRepository', () => {
  beforeEach(deleteDatabase);

  it('persists contacts and messages for only the selected identity', async () => {
    const repository = new BrowserChatRepository();
    const destinationHash = 'a'.repeat(32);
    await repository.saveMessage({
      id: 'identity-1:message-1',
      identityId: 'identity-1',
      messageId: 'message-1',
      sourceHash: destinationHash,
      destinationHash: 'd'.repeat(32),
      title: '',
      content: 'First version',
      receivedAt: '2026-07-16T10:01:00.000Z',
    });
    await repository.saveMessage({
      id: 'identity-1:message-1',
      identityId: 'identity-1',
      messageId: 'message-1',
      sourceHash: destinationHash,
      destinationHash: 'd'.repeat(32),
      title: '',
      content: 'Stored once',
      method: 'direct',
      direction: 'incoming',
      attempts: 1,
      verification: 'valid',
      stamp: { status: 'requiredAccepted', cost: 12 },
      receivedAt: '2026-07-16T10:01:00.000Z',
      path: {
        hops: 2,
        interfaceId: 'rnode-home',
        interfaceName: 'Home RNode',
        interfaceType: 'rnode',
      },
    });
    await repository.saveContact({
      id: `identity-1:${destinationHash}`,
      identityId: 'identity-1',
      destinationHash,
      name: 'Local Alice',
      createdAt: '2026-07-16T10:02:00.000Z',
      updatedAt: '2026-07-16T10:02:00.000Z',
    });

    const matching = await repository.load('identity-1');
    expect(matching.contacts).toHaveLength(1);
    expect(matching.contacts[0].name).toBe('Local Alice');
    expect(matching.messages).toHaveLength(1);
    expect(matching.messages[0].content).toBe('Stored once');
    expect(matching.messages[0]).toMatchObject({
      method: 'direct',
      direction: 'incoming',
      attempts: 1,
      verification: 'valid',
      stamp: { status: 'requiredAccepted', cost: 12 },
      path: {
        hops: 2,
        interfaceId: 'rnode-home',
        interfaceName: 'Home RNode',
        interfaceType: 'rnode',
      },
    });
    expect(await repository.load('identity-2')).toEqual({
      contacts: [],
      messages: [],
      blockedDestinations: [],
    });

    await repository.deleteContact(`identity-1:${destinationHash}`);
    expect((await repository.load('identity-1')).contacts).toEqual([]);
    await repository.deleteMessage('identity-1:message-1');
    expect((await repository.load('identity-1')).messages).toEqual([]);
  });

  it('loads contacts ordered by name and then destination address', async () => {
    const repository = new BrowserChatRepository();
    const saveContact = (destinationHash: string, name: string) => repository.saveContact({
      id: `identity-1:${destinationHash}`,
      identityId: 'identity-1',
      destinationHash,
      name,
      createdAt: '2026-07-16T10:02:00.000Z',
      updatedAt: '2026-07-16T10:02:00.000Z',
    });
    await saveContact('c'.repeat(32), 'Alpha');
    await saveContact('b'.repeat(32), 'Beta');
    await saveContact('a'.repeat(32), 'Alpha');

    expect((await repository.load('identity-1')).contacts.map(
      (contact) => contact.destinationHash,
    )).toEqual([
      'a'.repeat(32),
      'c'.repeat(32),
      'b'.repeat(32),
    ]);
  });

  it('migrates legacy messages into stable receipt segments', async () => {
    const peerHash = 'a'.repeat(32);
    const localHash = 'b'.repeat(32);
    const request = indexedDB.open('retivum', 13);
    await new Promise<void>((resolve, reject) => {
      request.onupgradeneeded = () => {
        request.result.createObjectStore('chatMessages', { keyPath: 'id' });
      };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const database = request.result;
        const transaction = database.transaction('chatMessages', 'readwrite');
        const store = transaction.objectStore('chatMessages');
        store.put({
          id: 'identity-1:before-reply',
          identityId: 'identity-1',
          messageId: 'before-reply',
          sourceHash: peerHash,
          destinationHash: localHash,
          title: '',
          content: 'Before',
          direction: 'incoming',
          timestamp: 200,
          receivedAt: '2026-07-16T10:00:00.000Z',
        });
        store.put({
          id: 'identity-1:reply',
          identityId: 'identity-1',
          messageId: 'reply',
          sourceHash: localHash,
          destinationHash: peerHash,
          title: '',
          content: 'Reply',
          direction: 'outgoing',
          timestamp: 300,
          receivedAt: '2026-07-16T10:01:00.000Z',
        });
        store.put({
          id: 'identity-1:delayed',
          identityId: 'identity-1',
          messageId: 'delayed',
          sourceHash: peerHash,
          destinationHash: localHash,
          title: '',
          content: 'Delayed',
          direction: 'incoming',
          timestamp: 100,
          receivedAt: '2026-07-16T10:02:00.000Z',
        });
        transaction.oncomplete = () => {
          database.close();
          resolve();
        };
        transaction.onerror = () => reject(transaction.error);
      };
    });

    const restored = await new BrowserChatRepository().load('identity-1');
    const byId = new Map(restored.messages.map((message) => [message.messageId, message.ordering]));

    expect(byId.get('before-reply')).toEqual({ segment: 0, receivedSequence: 0 });
    expect(byId.get('reply')).toEqual({
      segment: 1,
      receivedSequence: 1,
      boundaryReason: 'outgoing',
    });
    expect(byId.get('delayed')).toEqual({ segment: 1, receivedSequence: 2 });

    const database = await openRetivumDatabase();
    try {
      const transaction = database.transaction('chatMessages', 'readonly');
      const [persisted] = await Promise.all([
        requestResult<Record<string, unknown>>(
          transaction.objectStore('chatMessages').get('identity-1:delayed'),
        ),
        transactionDone(transaction),
      ]);
      expect(persisted.ordering).toEqual({ segment: 1, receivedSequence: 2 });
    } finally {
      database.close();
    }
  });

  it('migrates announce names into the global destination directory', async () => {
    const request = indexedDB.open('retivum', 10);
    await new Promise<void>((resolve, reject) => {
      request.onupgradeneeded = () => {
        request.result.createObjectStore('chatAnnounces', { keyPath: 'id' });
      };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const database = request.result;
        const transaction = database.transaction('chatAnnounces', 'readwrite');
        transaction.objectStore('chatAnnounces').put({
          id: `identity-1:${'e'.repeat(32)}`,
          identityId: 'identity-1',
          destinationHash: 'e'.repeat(32),
          identityHash: 'f'.repeat(32),
          publicKey: 'a'.repeat(128),
          displayName: 'Shared peer',
          heardAt: '2026-07-16T10:00:00.000Z',
        });
        transaction.oncomplete = () => {
          database.close();
          resolve();
        };
        transaction.onerror = () => reject(transaction.error);
      };
    });

    const directory = await new BrowserChatRepository().load('identity-1');
    expect(directory.messages).toEqual([]);
    expect(await new BrowserKnownDestinationRepository().loadAll()).toEqual([{
      destinationHash: 'e'.repeat(32),
      fullDestinationName: 'lxmf.delivery',
      displayName: 'Shared peer',
      lastAnnouncedAt: '2026-07-16T10:00:00.000Z',
      metadata: {},
    }]);
  });

  it('persists blocked destinations per identity', async () => {
    const repository = new BrowserChatRepository();
    const destinationHash = 'f'.repeat(32);
    await repository.saveBlockedDestination({
      id: `identity-1:${destinationHash}`,
      identityId: 'identity-1',
      destinationHash,
      blockedAt: '2026-07-16T10:00:00.000Z',
    });

    expect((await repository.load('identity-1')).blockedDestinations).toHaveLength(1);
    expect((await repository.load('identity-2')).blockedDestinations).toEqual([]);

    await repository.deleteBlockedDestination(`identity-1:${destinationHash}`);
    expect((await repository.load('identity-1')).blockedDestinations).toEqual([]);
  });

  it('atomically replaces an outbound attempt without leaving a duplicate message', async () => {
    const repository = new BrowserChatRepository();
    const original = {
      id: 'identity-1:primary',
      identityId: 'identity-1',
      messageId: 'primary',
      sourceHash: 'a'.repeat(32),
      destinationHash: 'b'.repeat(32),
      title: '',
      content: 'Fallback message',
      direction: 'outgoing' as const,
      status: 'failed' as const,
      propagationFallbackPending: false,
      receivedAt: '2026-07-16T10:01:00.000Z',
    };
    await repository.saveMessage(original);
    await repository.replaceMessage(original.id, {
      ...original,
      id: 'identity-1:propagated',
      messageId: 'propagated',
      method: 'propagated',
      status: 'queued',
    });

    const restored = await repository.load('identity-1');
    expect(restored.messages).toHaveLength(1);
    expect(restored.messages[0]).toMatchObject({ messageId: 'propagated', method: 'propagated', status: 'queued' });
  });

  it('deletes multiple conversation messages in one operation', async () => {
    const repository = new BrowserChatRepository();
    const base = {
      identityId: 'identity-1',
      sourceHash: 'a'.repeat(32),
      destinationHash: 'b'.repeat(32),
      title: '',
      receivedAt: '2026-07-16T10:01:00.000Z',
    };
    await repository.saveMessage({ ...base, id: 'identity-1:first', messageId: 'first', content: 'First' });
    await repository.saveMessage({ ...base, id: 'identity-1:second', messageId: 'second', content: 'Second' });
    await repository.saveMessage({
      ...base,
      id: 'identity-1:other',
      messageId: 'other',
      sourceHash: 'c'.repeat(32),
      content: 'Keep this',
    });

    await repository.deleteMessages(['identity-1:first', 'identity-1:second']);

    const restored = await repository.load('identity-1');
    expect(restored.messages.map((message) => message.messageId)).toEqual(['other']);
  });

  it('deletes expired history in every message state while preserving recent messages', async () => {
    const repository = new BrowserChatRepository();
    const base = {
      identityId: 'identity-1',
      sourceHash: 'a'.repeat(32),
      destinationHash: 'b'.repeat(32),
      title: '',
    };
    await repository.saveMessage({
      ...base,
      id: 'identity-1:old-incoming',
      messageId: 'old-incoming',
      content: 'Expired incoming',
      attachments: [{
        kind: 'file',
        name: 'expired.bin',
        mimeType: 'application/octet-stream',
        data: new Uint8Array([1, 2, 3, 4]),
      }],
      receivedAt: '2026-07-01T10:00:00.000Z',
    });
    await repository.saveMessage({
      ...base,
      id: 'identity-1:old-delivered',
      messageId: 'old-delivered',
      content: 'Expired delivered',
      direction: 'outgoing',
      status: 'delivered',
      receivedAt: '2026-07-01T10:00:00.000Z',
    });
    await repository.saveMessage({
      ...base,
      id: 'identity-1:old-queued',
      messageId: 'old-queued',
      content: 'Pending',
      direction: 'outgoing',
      status: 'queued',
      receivedAt: '2026-07-01T10:00:00.000Z',
    });
    await repository.saveMessage({
      ...base,
      id: 'identity-1:old-fallback-pending',
      messageId: 'old-fallback-pending',
      content: 'Pending fallback',
      direction: 'outgoing',
      status: 'failed',
      propagationFallbackPending: true,
      receivedAt: '2026-07-01T10:00:00.000Z',
    });
    await repository.saveMessage({
      ...base,
      id: 'identity-1:recent',
      messageId: 'recent',
      content: 'Recent',
      receivedAt: '2026-07-22T10:00:00.000Z',
    });

    await expect(repository.deleteExpiredMessages(
      'identity-1',
      Date.parse('2026-07-21T10:00:00.000Z'),
    )).resolves.toEqual([
      'identity-1:old-delivered',
      'identity-1:old-fallback-pending',
      'identity-1:old-incoming',
      'identity-1:old-queued',
    ]);

    expect((await repository.load('identity-1')).messages.map((message) => message.messageId)).toEqual([
      'recent',
    ]);

    const database = await openRetivumDatabase();
    try {
      const transaction = database.transaction('chatMessages', 'readonly');
      const [expiredRecord] = await Promise.all([
        requestResult(transaction.objectStore('chatMessages').get('identity-1:old-incoming')),
        transactionDone(transaction),
      ]);
      expect(expiredRecord).toBeUndefined();
    } finally {
      database.close();
    }
  });
});
